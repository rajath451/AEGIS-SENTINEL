import os
import json
import logging
import asyncio
import sys
import io
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
import socketserver

# Reconfigure stdout/stderr on Windows to prevent UnicodeEncodeError with console emojis
if sys.platform.startswith('win'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add current directory to path just in case
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import the existing modules
try:
    from voice_engine import process_crisis_audio
    from data_core import fetch_live_crisis_data
    from brain_engine import verify_and_extract_coordinates
    from memory_automation import persist_and_alert
except ImportError as e:
    print(f"Warning: Could not import core components directly. Some elements will run in mock mode: {e}")

# Import MongoDB secure backend database layer
try:
    import mongodb_client
except ImportError as e:
    print(f"Warning: Could not import mongodb_client: {e}")
    mongodb_client = None


# Global storage for the latest run cache
latest_run_data = {
    "status": "idle",
    "logs": [],
    "transcript": "",
    "serp": {},
    "insights": [],
    "alerts": []
}

# Thread-safe log capturing handler
class ListLogHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records_list = []

    def emit(self, record):
        log_entry = self.format(record)
        self.records_list.append(log_entry)

# Setup log capturer
log_capturer = ListLogHandler()
log_capturer.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logging.getLogger().addHandler(log_capturer)
logging.getLogger().setLevel(logging.INFO)

import urllib.request
import urllib.parse

def geocode_location_free(location_name):
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(location_name)}&format=json&limit=1"
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'CrisisIntelligenceTerminal/1.0 (emergency response system dashboard geocoder)'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data and len(data) > 0:
                lat = float(data[0]['lat'])
                lng = float(data[0]['lon'])
                return lat, lng
    except Exception as e:
        print(f"OSM Nominatim Geocoding failed for {location_name}: {e}")
    return None

class CrisisDashboardHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        # Allow CORS
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        # Extract purely the path component to ignore any query parameters (e.g. ?logs-container.)
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == '/api/latest':
            self.send_cors_headers('application/json')
            self.wfile.write(json.dumps(latest_run_data).encode('utf-8'))
            return
            
        elif path == '/api/operator/localize':
            self.send_cors_headers('application/json')
            if mongodb_client:
                params = urllib.parse.parse_qs(parsed_url.query)
                email = params.get('email', [None])[0]
                if email:
                    coords = mongodb_client.get_operator_coordinates(email)
                    self.wfile.write(json.dumps({"status": "success", "coords": coords}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"status": "error", "message": "Email query param is required"}).encode('utf-8'))
            else:
                self.wfile.write(json.dumps({"status": "error", "message": "MongoDB driver not available"}).encode('utf-8'))
            return

            
        elif path == '/api/firebase-config':
            self.send_cors_headers('application/json')
            config = {
                "apiKey": os.environ.get("FIREBASE_API_KEY", ""),
                "authDomain": os.environ.get("FIREBASE_AUTH_DOMAIN", ""),
                "projectId": os.environ.get("FIREBASE_PROJECT_ID", ""),
                "storageBucket": os.environ.get("FIREBASE_STORAGE_BUCKET", ""),
                "messagingSenderId": os.environ.get("FIREBASE_MESSAGING_SENDER_ID", ""),
                "appId": os.environ.get("FIREBASE_APP_ID", ""),
                "measurementId": os.environ.get("FIREBASE_MEASUREMENT_ID", "")
            }
            self.wfile.write(json.dumps(config).encode('utf-8'))
            return
        
        # Serve static files from the 'web' directory
        web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
        
        # Default route to index.html
        if path == '/' or path == '':
            path = '/index.html'
            
        file_path = os.path.join(web_dir, path.lstrip('/'))
        
        # Resolve real path to prevent directory traversal vulnerability
        real_web_dir = os.path.realpath(web_dir)
        real_file_path = os.path.realpath(file_path)
        
        if not real_file_path.startswith(real_web_dir):
            self.send_error(403, "Access Denied")
            return
            
        if os.path.exists(file_path) and os.path.isfile(file_path):
            content_type = self.get_content_type(file_path)
            file_size = os.path.getsize(file_path)
            
            range_header = self.headers.get('Range')
            if range_header and range_header.startswith('bytes='):
                try:
                    ranges = range_header.split('=')[1].split('-')
                    start = int(ranges[0]) if ranges[0] else 0
                    end = int(ranges[1]) if (len(ranges) > 1 and ranges[1]) else file_size - 1
                    
                    if start >= file_size:
                        start = file_size - 1
                    if end >= file_size:
                        end = file_size - 1
                    if start > end:
                        start = end
                        
                    length = end - start + 1
                    
                    self.send_response(206)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                    self.send_header('Content-Length', str(length))
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    
                    with open(file_path, 'rb') as f:
                        f.seek(start)
                        self.wfile.write(f.read(length))
                    return
                except Exception as range_err:
                    print(f"Error handling range request: {range_err}")
            
            # Standard complete response
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(file_size))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            with open(file_path, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_error(404, f"File Not Found: {path}")

    def do_POST(self):
        # Extract purely the path component to ignore any query parameters
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == '/api/auth/register':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            self.send_cors_headers('application/json')
            try:
                data = json.loads(post_data)
                email = data.get('email')
                password = data.get('password')
                
                if not email or not password:
                    self.wfile.write(json.dumps({"status": "error", "message": "Email and password are required"}).encode('utf-8'))
                    return
                
                if mongodb_client:
                    success, msg = mongodb_client.register_operator(email, password)
                    if success:
                        self.wfile.write(json.dumps({"status": "success", "message": msg}).encode('utf-8'))
                    else:
                        self.wfile.write(json.dumps({"status": "error", "message": msg}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"status": "error", "message": "MongoDB driver not available"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        elif path == '/api/auth/login':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            self.send_cors_headers('application/json')
            try:
                data = json.loads(post_data)
                email = data.get('email')
                password = data.get('password')
                
                if not email or not password:
                    self.wfile.write(json.dumps({"status": "error", "message": "Email and password are required"}).encode('utf-8'))
                    return
                
                if mongodb_client:
                    success, op_data = mongodb_client.authenticate_operator(email, password)
                    if success:
                        self.wfile.write(json.dumps({"status": "success", "operator": op_data}).encode('utf-8'))
                    else:
                        self.wfile.write(json.dumps({"status": "error", "message": "Invalid email or password."}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"status": "error", "message": "MongoDB driver not available"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        elif path == '/api/operator/localize':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            self.send_cors_headers('application/json')
            try:
                data = json.loads(post_data)
                email = data.get('email')
                lat = data.get('lat')
                lng = data.get('lng')
                
                if not email or lat is None or lng is None:
                    self.wfile.write(json.dumps({"status": "error", "message": "Email, lat, and lng are required"}).encode('utf-8'))
                    return
                
                if mongodb_client:
                    success = mongodb_client.update_operator_coordinates(email, lat, lng)
                    if success:
                        self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
                    else:
                        self.wfile.write(json.dumps({"status": "error", "message": "Failed to update operator coordinates"}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"status": "error", "message": "MongoDB driver not available"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        elif path == '/api/operator/mail':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            self.send_cors_headers('application/json')
            try:
                data = json.loads(post_data)
                
                if mongodb_client:
                    success = mongodb_client.log_mail_warning(data)
                    if success:
                        self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
                    else:
                        self.wfile.write(json.dumps({"status": "error", "message": "Failed to log mail warning"}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"status": "error", "message": "MongoDB driver not available"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        elif path == '/api/upload-audio':

            content_length = int(self.headers.get('Content-Length', 0))
            audio_bytes = self.rfile.read(content_length)
            
            # Save raw bytes to file recorded_mic.wav
            audio_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recorded_mic.wav")
            try:
                with open(audio_file_path, "wb") as f:
                    f.write(audio_bytes)
                self.send_cors_headers('application/json')
                self.wfile.write(json.dumps({"status": "success", "message": "Audio saved successfully"}).encode('utf-8'))
            except Exception as e:
                print(f"Error saving uploaded audio: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
                
        elif path == '/api/run':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            
            # Default options
            options = {"simulated": True, "query": "emergency response Broadway Street fire disaster"}
            if post_data:
                try:
                    options.update(json.loads(post_data))
                except Exception:
                    pass
            
            self.send_cors_headers('application/json')
            
            try:
                # Trigger the pipeline run
                response_data = self.execute_pipeline(options)
                self.wfile.write(json.dumps(response_data).encode('utf-8'))
            except Exception as e:
                err_msg = f"Pipeline execution failed: {e}\n{traceback.format_exc()}"
                print(err_msg)
                self.wfile.write(json.dumps({
                    "status": "error",
                    "error": str(e),
                    "logs": [err_msg]
                }).encode('utf-8'))
        else:
            self.send_error(404, "Endpoint not found")

    def send_cors_headers(self, content_type='application/json'):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def get_content_type(self, filepath):
        if filepath.endswith('.html'): return 'text/html'
        if filepath.endswith('.css'): return 'text/css'
        if filepath.endswith('.js'): return 'application/javascript'
        if filepath.endswith('.json'): return 'application/json'
        if filepath.endswith('.png'): return 'image/png'
        if filepath.endswith('.jpg') or filepath.endswith('.jpeg'): return 'image/jpeg'
        if filepath.endswith('.mp3'): return 'audio/mpeg'
        if filepath.endswith('.mp4'): return 'video/mp4'
        return 'application/octet-stream'

    def execute_pipeline(self, options):
        global latest_run_data
        
        simulated = options.get("simulated", True)
        search_query = options.get("query", "emergency response Broadway Street fire disaster")
        
        # Clear log list for this run
        log_capturer.records_list.clear()
        
        logger = logging.getLogger("AEGISCoordinationWeb")
        logger.info("================================================================================")
        logger.info(f"🚀 INITIATING AEGIS COORDINATION SEQUENCE (Mode: {'SIMULATED' if simulated else 'PRODUCTION'})")
        logger.info("================================================================================")

        alerts_list = []
        
        # Dynamic TriggerWare payload interceptor for alerts
        def web_alert_interceptor(workflow_id, payload):
            msg = payload.get("msg", "")
            alerts_list.append({
                "workflow_id": workflow_id,
                "message": msg
            })
            # Also invoke normal triggerware log
            from triggerware import trigger_action
            trigger_action(workflow_id, payload)
        
        # Save old trigger_action if we're running production
        import memory_automation
        original_trigger = memory_automation.trigger_action
        memory_automation.trigger_action = web_alert_interceptor
        
        try:
            if simulated:
                # --- RUN SIMULATION ---
                custom_text = options.get("custom_transcript")
                
                if custom_text:
                    logger.info("🎙️ [STEP 1] Ingesting manual microphone voice audio recording...")
                    logger.info(f"🔊 Live Microphone Transcript: \"{custom_text}\"")
                    audio_transcript = custom_text
                    
                    logger.info("🌐 [STEP 2] Launching Bright Data SERP API Data Core query...")
                    from data_core import get_mock_serp_data
                    serp_data = get_mock_serp_data(search_query)
                    
                    logger.info("🧠 [STEP 3] Analyzing custom speech data via Gemini...")
                    try:
                        insights_str = verify_and_extract_coordinates(audio_transcript, serp_data, search_query)
                        insights_json = json.loads(insights_str)
                    except Exception as e:
                        logger.warning(f"⚠️ Live Gemini extraction failed: {e}. Falling back to dynamic search geocoding.")
                        coords = geocode_location_free(search_query)
                        if not coords and audio_transcript:
                            coords = geocode_location_free(audio_transcript)
                        
                        if coords:
                            lat, lng = coords
                            loc_name = search_query.title()
                        else:
                            lat, lng = 40.758896, -73.985130
                            loc_name = "Emergency Center"
                            
                        insights_json = [
                            {
                                "location_name": f"{loc_name} Alert Sector",
                                "status": "HAZARD",
                                "details": f"Emergency safety warning active at {loc_name}.",
                                "lat": lat,
                                "lng": lng,
                                "precautions": f"Stay clear of active hazard areas in {loc_name}. Monitor weather and emergency networks."
                            }
                        ]
                else:
                    country = options.get("country", "world")
                    logger.info(f"🎙️ [STEP 1] Loading pre-recorded simulated feed for target region: [{country.toUpperCase() if hasattr(country, 'toUpperCase') else country.upper()}]")
                    logger.info("🎙️ [Speechmatics Client] Initiating audio transcription...")
                    logger.info("✅ Job submitted successfully. Job ID: mock_job_9982. Polling for transcript...")
                    logger.info("⏳ Polling job status (Attempt 1/30): done")
                    logger.info("🔊 Speechmatics API successfully responded (Silent audio detected).")
                    
                    if country == "japan":
                        audio_transcript = (
                            "Japan Weather & Disaster Center: Active blizzard storm warning in Hokkaido. "
                            "Sendai Coastline JMA tsunami warning remains active following severe offshore seismic shifts. "
                            "Tokyo Dome has been opened as an earthquake safe shelter. Sakurajima Volcano monitoring base "
                            "is dispatching ash respirators to Kyushu."
                        )
                        insights_json = [
                            {
                                "location_name": "Hokkaido Blizzard Hazard (North)",
                                "status": "HAZARD",
                                "details": "Extreme sub-zero heavy blizzard, heavy snowfall, and whiteout road blockages.",
                                "lat": 43.0618,
                                "lng": 141.3545,
                                "precautions": "Heavy blizzard alert! Avoid outdoor driving, keep home heating ventilation clear, and monitor local weather broadcasts."
                            },
                            {
                                "location_name": "Sendai Coastline Tsunami Hazard (East)",
                                "status": "HAZARD",
                                "details": "Seismic sea swells rising rapidly. Emergency evacuation orders remain fully in effect.",
                                "lat": 38.2682,
                                "lng": 140.8693,
                                "precautions": "Tsunami warning active! Evacuate immediately to designated high ground or third floor of reinforced concrete structures."
                            },
                            {
                                "location_name": "Tokyo Dome Shelter (Central)",
                                "status": "SAFE_ZONE",
                                "details": "Fortified sports dome active as primary secure earthquake survivor shelter.",
                                "lat": 35.7056,
                                "lng": 139.7519,
                                "precautions": "Tokyo Dome is active. Stockpiled drinking water, blankets, and safety helmets are actively being distributed."
                            },
                            {
                                "location_name": "Sakurajima Ash Station (South)",
                                "status": "RESOURCE",
                                "details": "Emergency ash respirator masks and eye goggles distribution base at Kagoshima Volcanology base.",
                                "lat": 31.5966,
                                "lng": 130.5571,
                                "precautions": "Volcanic ash fallout warning! Wear double eye-protection and heavy-dust masks when outdoors. Evacuate if seismic levels increase."
                            }
                        ]
                    elif country == "india":
                        audio_transcript = (
                            "India National Disaster Alert: Extreme monsoon flooding submerging Marine Drive in Mumbai. "
                            "Severe Bay of Bengal Cyclone warning issued for coastal Chennai. Toxic smog levels reported in New Delhi. "
                            "Assam rescue center reports landslides. Safe havens active at Wankhede Stadium Mumbai."
                        )
                        insights_json = [
                            {
                                "location_name": "New Delhi Toxic Smog (North)",
                                "status": "HAZARD",
                                "details": "Critical atmospheric PM2.5 levels. Heavy smog causing extreme low visibility and respiratory risk.",
                                "lat": 28.6139,
                                "lng": 77.2090,
                                "precautions": "Critical smog & toxic air pollution level. Limit outdoor physical exercises and stay indoors with air purifiers active."
                            },
                            {
                                "location_name": "Marine Drive Monsoon Flood (West)",
                                "status": "HAZARD",
                                "details": "Extreme monsoon cloudburst flooding and coastal sea wave overflow. Roads entirely impassable.",
                                "lat": 19.0760,
                                "lng": 72.8777,
                                "precautions": "Severe flooding active! Avoid coastal areas, low-lying subways, and keep emergency contact numbers ready."
                            },
                            {
                                "location_name": "Wankhede Stadium Safe Camp (West)",
                                "status": "SAFE_ZONE",
                                "details": "Dry indoor relocation sanctuary. Triage center, warm clothing, and hot meals fully active.",
                                "lat": 18.9389,
                                "lng": 72.8258,
                                "precautions": "Wankhede Stadium is active as a municipal safe haven. Food, water, and dry clothes are available."
                            },
                            {
                                "location_name": "Chennai Cyclone Relief Station (South)",
                                "status": "RESOURCE",
                                "details": "Logistics hub shipping emergency inflatable rafts, satellite phones, and clean hydration crates.",
                                "lat": 13.0827,
                                "lng": 80.2707,
                                "precautions": "Severe Bay of Bengal cyclone warning. Secure roof tiles, charge communication devices, and relocate to concrete municipal shelters."
                            },
                            {
                                "location_name": "Guwahati Landslide Rescue (East)",
                                "status": "HAZARD",
                                "details": "Torrential monsoon landslide. Heavy debris blockages blocking major highway coordinates.",
                                "lat": 26.1445,
                                "lng": 91.7362,
                                "precautions": "Torrential landslide hazard. Avoid landslide-prone rocky cliffs and steep mountain valleys."
                            }
                        ]
                    elif country == "usa":
                        audio_transcript = (
                            "US Emergency Operations: Severe blizzard blizzard active in New York City. "
                            "Category 3 Hurricane landfall imminent along Miami Beach. Sierra forest wildfire spreading near Sacramento. "
                            "Tornado watch warnings issued for Oklahoma City. Secure cots active at Sacramento Arena."
                        )
                        insights_json = [
                            {
                                "location_name": "California Sierra Wildfire (West)",
                                "status": "HAZARD",
                                "details": "Rapidly moving timber fire. Dangerous smoke plumes moving westward towards urban areas.",
                                "lat": 37.7749,
                                "lng": -122.4194,
                                "precautions": "Active wildland fire! Follow immediate evacuation orders from Cal-Fire. Keep N95 air-filtering masks worn at all times."
                            },
                            {
                                "location_name": "New York City Blizzard (East)",
                                "status": "HAZARD",
                                "details": "Extreme sub-zero heavy blizzard, heavy snow, and frozen roads across Manhattan.",
                                "lat": 40.7128,
                                "lng": -74.0060,
                                "precautions": "Extreme low temperatures and heavy snow storm. Avoid driving on icy highways and keep indoor heating systems clear."
                            },
                            {
                                "location_name": "Miami Beach Hurricane Warning (South)",
                                "status": "HAZARD",
                                "details": "Dangerous Category 3 hurricane storm surge waves. Coastal winds exceeding 110 mph.",
                                "lat": 25.7617,
                                "lng": -80.1918,
                                "precautions": "Category 3 hurricane landfall imminent. Board up all windows and evacuate low-lying coastal zones."
                            },
                            {
                                "location_name": "Oklahoma Tornado Shelter (Central)",
                                "status": "SAFE_ZONE",
                                "details": "Concrete-reinforced underground cyclone bunker. First aid supplies active.",
                                "lat": 35.4676,
                                "lng": -97.5164,
                                "precautions": "Tornado watch active! Seek immediate underground cellar refuge or interior hallway if sirens sound."
                            }
                        ]
                    elif country == "uk":
                        audio_transcript = (
                            "UK Met Office Warning: Gale wind warning at Dover Harbour. Scotland Highlands "
                            "under extreme freeze warnings. Severe river flood warnings active in Cardiff. "
                            "London Logistics port is active shipping emergency generators."
                        )
                        insights_json = [
                            {
                                "location_name": "Dover Harbour Storm Gale (South)",
                                "status": "HAZARD",
                                "details": "Severe gale winds storm. High coastal wave inundation hazard.",
                                "lat": 51.1279,
                                "lng": 1.3134,
                                "precautions": "Severe Force 9 gales active! Avoid harbor walls, coastal roads, and secure all loose outdoor property immediately."
                            },
                            {
                                "location_name": "Edinburgh Extreme Freeze (North)",
                                "status": "HAZARD",
                                "details": "Sub-zero ice temperatures and freezing black ice roads across Scotland.",
                                "lat": 55.9533,
                                "lng": -3.1883,
                                "precautions": "Sub-zero temperatures active. Protect water pipes from freezing and use salt grids on stairs."
                            },
                            {
                                "location_name": "Cardiff Severn River Flood (West)",
                                "status": "HAZARD",
                                "details": "Severn river overflow hazard. Inundating local residential streets.",
                                "lat": 51.4816,
                                "lng": -3.1791,
                                "precautions": "Severe river flooding active. Avoid riverbanks, place sandbags at thresholds, and move values to second floors."
                            },
                            {
                                "location_name": "London Port Support Hub (East)",
                                "status": "RESOURCE",
                                "details": "Emergency logistics shipping point. Sending emergency sandbags, generators, and heavy blankets.",
                                "lat": 51.5074,
                                "lng": -0.1278,
                                "precautions": "London Thames coordination center is shipping sandbags, windbreaks, and backup diesel generators."
                            }
                        ]
                    elif country == "world" or country == "global" or country == "default":
                        # World / Global scale distributed alerts across major continents
                        audio_transcript = (
                            "Global Intelligence Center Dispatch: Extreme weather and active natural disasters warnings "
                            "around the world. Torrential rainfall mudslides in Rio de Janeiro, South America. "
                            "Volatile wildfire hazard moving in California, North America. "
                            "Severe Bay of Bengal coastal storm cyclone warning in Chennai, Asia. "
                            "Active severe khamsin sandstorm hazard in Cairo, Africa. "
                            "Heavy storms flooding in Sydney, Australia. Safe shelter sanctuaries active at Tokyo Dome."
                        )
                        insights_json = [
                            {
                                "location_name": "California Wildfire Hazard (North America)",
                                "status": "HAZARD",
                                "details": "Active brush and forest fire spreading under high gale winds.",
                                "lat": 37.7749,
                                "lng": -122.4194,
                                "precautions": "Forest fire active. Wear protective N95 filtration masks and follow evacuation notices."
                            },
                            {
                                "location_name": "Tokyo Dome Shelter (Asia)",
                                "status": "SAFE_ZONE",
                                "details": "Fortified multi-purpose indoor shelter active for seismic tremors relocations.",
                                "lat": 35.7056,
                                "lng": 139.7519,
                                "precautions": "Seismic safe shelter active. Food rations, clean drinking water, and blankets actively distributed."
                            },
                            {
                                "location_name": "Sydney Coastal Storms (Australia)",
                                "status": "HAZARD",
                                "details": "Extreme storm surges, sea wave overflow, and localized estuary flooding.",
                                "lat": -33.8688,
                                "lng": 151.2093,
                                "precautions": "Coastal storms active. Stay clear of flooded ocean bridges and low-lying storm channels."
                            },
                            {
                                "location_name": "Cairo Sandstorm Hazard (Africa)",
                                "status": "HAZARD",
                                "details": "Severe desert sandstorm reducing visibility to under 100 meters across Egypt.",
                                "lat": 30.0444,
                                "lng": 31.2357,
                                "precautions": "Severe dust storm. Keep all windows tightly sealed and wear protective face masks if outdoors."
                            },
                            {
                                "location_name": "Rio de Janeiro Mudslides (South America)",
                                "status": "HAZARD",
                                "details": "Torrential cloudburst rains leading to severe hillside soil mudslides.",
                                "lat": -22.9068,
                                "lng": -43.1729,
                                "precautions": "Hillside mudslide alert! Preemptively evacuate unstable sloped areas and seek solid concrete structures."
                            },
                            {
                                "location_name": "Dover Harbour Storm Gale (Europe)",
                                "status": "HAZARD",
                                "details": "Severe gale winds storm warning active along the English Channel.",
                                "lat": 51.1279,
                                "lng": 1.3134,
                                "precautions": "Gale wind hazard active! Secure loose outdoor properties and stay clear of waterfront sea walls."
                            }
                        ]
                    elif country == "local":
                        user_lat = options.get("user_lat")
                        user_lng = options.get("user_lng")
                        
                        if user_lat and user_lng:
                            audio_transcript = (
                                f"Local Emergency Operations: High risk flooding and structural wind hazards detected near your sector. "
                                f"Please take immediate shelter at your secured safe rally coordinates."
                            )
                            insights_json = [
                                {
                                    "location_name": "Active Flooding & Gale Sector (Nearby)",
                                    "status": "HAZARD",
                                    "details": "Severe structural threat and localized monsoon flash floods traveling towards coordinates.",
                                    "lat": user_lat + 0.007,
                                    "lng": user_lng - 0.006,
                                    "precautions": "Seek high reinforced shelter immediately. Secure critical equipment and documents."
                                },
                                {
                                    "location_name": "Your Exact Position (Safe Shelter)",
                                    "status": "SAFE_ZONE",
                                    "details": "Secured geocoded location. Designated coordinate rally zone.",
                                    "lat": user_lat,
                                    "lng": user_lng,
                                    "precautions": "Maintain sensory beacon, verify survival prep supplies, and wait for emergency alerts."
                                }
                            ]
                        else:
                            audio_transcript = "Local Geocentric Dispatch: Authorized location search parameters unresolvable."
                            insights_json = [
                                {
                                    "location_name": "Unresolved Location Center",
                                    "status": "HAZARD",
                                    "details": "Device coordinate permission required to scan active sectors.",
                                    "lat": 40.7549,
                                    "lng": -73.9840,
                                    "precautions": "Grant system location access to map safe routes dynamically."
                                }
                            ]
                    else:
                        audio_transcript = "General Emergency Registry: Scanning active hazards."
                        insights_json = [
                            {
                                "location_name": "Emergency Operations Command Center",
                                "status": "RESOURCE",
                                "details": "Active safety tracking and coordinates monitoring active.",
                                "lat": 40.7549,
                                "lng": -73.9840,
                                "precautions": "Follow dispatcher alerts and coordinate instructions."
                            }
                        ]
                        
                    logger.info(f"🔊 Speechmatics Transcription Output:\n--- START TRANSCRIPT ---\n{audio_transcript}\n--- END TRANSCRIPT ---\n")
                    
                    logger.info("🌐 [STEP 2] Launching Bright Data SERP API Data Core query...")
                    from data_core import get_mock_serp_data
                    serp_data = get_mock_serp_data(search_query)
                
                insights_str = json.dumps(insights_json, indent=2)
                logger.info(f"🎯 Verified Engine Output (Structured JSON):\n{insights_str}\n")
                
                logger.info("💾 [STEP 4] Committing data to Cognee memory and evaluating TriggerWare conditions...")
                for item in insights_json:
                    logger.info(f"🧠 [Cognee] Attempting to cognify: {item['location_name']} ({item['status']})")
                    logger.info(f"💾 [Cognee Mock] Graph Node created: {item['location_name']} -> {item['status']}")
                
                # Intercepted Triggerware deployment
                main_hazard = next((i for i in insights_json if i["status"] == "HAZARD"), insights_json[0] if insights_json else None)
                if main_hazard:
                    web_alert_interceptor(
                        workflow_id="emergency_slack_alert",
                        payload={"msg": f"CRITICAL HAZARD DETECTED: {main_hazard.get('details')} at {main_hazard.get('location_name')}"}
                    )
                
            else:
                # --- RUN PRODUCTION (REAL API CALLS) ---
                logger.info("🎙️ [STEP 1] Ingesting live audio broadcast feed...")
                
                # Check if custom microphone audio was uploaded
                audio_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recorded_mic.wav")
                if os.path.exists(audio_file) and options.get("custom_transcript"):
                    logger.info("🎙️ Ingesting custom microphone recording (recorded_mic.wav)")
                else:
                    audio_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "emergency_radio_clip.mp3")
                    logger.info("🎙️ Ingesting default emergency broadcast feed (emergency_radio_clip.mp3)")
                
                audio_transcript = process_crisis_audio(audio_file)
                
                # Fallback to custom speech text if transcription came back empty
                if not audio_transcript.strip() and options.get("custom_transcript"):
                    audio_transcript = options.get("custom_transcript")
                    logger.info(f"🎙️ Using browser speech-to-text fallback transcript: \"{audio_transcript}\"")
                
                logger.info("🌐 [STEP 2] Launching Bright Data SERP API Data Core query...")
                serp_data = fetch_live_crisis_data(search_query)
                
                logger.info("🧠 [STEP 3] Analyzing data integrity and cross-referencing truth via Gemini...")
                insights_str = verify_and_extract_coordinates(audio_transcript, serp_data, search_query)
                
                try:
                    insights_json = json.loads(insights_str)
                    
                    # Fill coordinates only if missing from Gemini
                    for item in insights_json:
                        if "lat" in item and "lng" in item and item["lat"] and item["lng"]:
                            continue
                            
                        # Use dynamic geocoding fallback first!
                        coords = geocode_location_free(item.get("location_name", ""))
                        if not coords:
                            coords = geocode_location_free(search_query)
                            
                        if coords:
                            item["lat"], item["lng"] = coords
                            continue
                            
                        # Static NYC fallback markers
                        loc = item.get("location_name", "").lower()
                        if "broadway" in loc:
                            item["lat"] = 40.758896
                            item["lng"] = -73.985130
                        elif "central park" in loc or "park" in loc:
                            item["lat"] = 40.785091
                            item["lng"] = -73.968285
                        elif "5th avenue" in loc or "avenue" in loc:
                            item["lat"] = 40.77443
                            item["lng"] = -73.96563
                        else:
                            # Default NYC Manhattan center
                            item["lat"] = 40.7549
                            item["lng"] = -73.9840
                except Exception as parse_err:
                    logger.error(f"Could not inject map coordinates to output: {parse_err}")
                    insights_json = []
                
                logger.info("💾 [STEP 4] Committing data to Cognee memory and evaluating TriggerWare conditions...")
                asyncio.run(persist_and_alert(json.dumps(insights_json)))

            logger.info("================================================================================")
            logger.info("✅ AEGIS COORDINATION CYCLE COMPLETED SUCCESSFULLY!")
            logger.info("================================================================================")

            # Package output data
            run_result = {
                "status": "success",
                "simulated": simulated,
                "logs": list(log_capturer.records_list),
                "transcript": audio_transcript,
                "serp": serp_data,
                "insights": insights_json if simulated else json.loads(insights_str),
                "alerts": alerts_list
            }
            
            # Cache it
            latest_run_data = run_result
            return run_result
            
        finally:
            # Restore original triggerware function
            memory_automation.trigger_action = original_trigger

def run_server(port=8000):
    handler = CrisisDashboardHandler
    # Enable socket reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    # Try booting on target port, fallback to scanning if unavailable
    max_port = port + 80
    while port < max_port:
        try:
            with socketserver.TCPServer(("", port), handler) as httpd:
                print(f"\n=======================================================")
                print(f"🌍 CRISIS DASHBOARD SERVER RUNNING AT: http://localhost:{port}")
                print(f"💻 Serves premium frontend assets from: ./web/")
                print(f"=======================================================\n")
                httpd.serve_forever()
                break
        except OSError:
            print(f"⚠️ Port {port} is occupied, trying port {port + 1}...")
            port += 1

if __name__ == "__main__":
    # Support dynamic PORT assignment for Hugging Face Spaces and Render
    port_env = os.environ.get("PORT")
    target_port = int(port_env) if port_env else 8000
    run_server(port=target_port)
