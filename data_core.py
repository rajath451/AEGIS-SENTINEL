import os
import json
import logging
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = logging.getLogger("BrightDataDataCore")

def fetch_live_crisis_data(query="emergency Broadway Street fire"):
    """
    Fetches real-time structured web context using Bright Data's SERP API.
    Lists active zones first, finds a suitable zone, and triggers the search query.
    If none exist or credentials fail, falls back gracefully.
    """
    api_token = os.getenv("BRIGHT_DATA_API_TOKEN")
    if not api_token:
        logger.warning("⚠️ BRIGHT_DATA_API_TOKEN is not set in environment or .env file.")
        return get_mock_serp_data(query)

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }

    try:
        # Step 1: Discover active zones
        logger.info("🌐 [Bright Data] Requesting active zones from Account API...")
        zones_response = requests.get(
            "https://api.brightdata.com/zone/get_active_zones",
            headers=headers,
            timeout=10
        )
        
        if zones_response.status_code != 200:
            logger.warning(
                f"⚠️ [Bright Data] Failed to fetch active zones (Status: {zones_response.status_code}). "
                f"Response: {zones_response.text}. Using fallback SERP data core."
            )
            return get_mock_serp_data(query)
        
        zones = zones_response.json()
        logger.info(f"🌐 [Bright Data] Successfully listed active zones: {[z.get('name') for z in zones]}")
        
        # Step 2: Look for a SERP or web-unlocker zone, or default to the first one
        serp_zone = None
        for zone in zones:
            if "serp" in zone.get("name", "").lower() or "search" in zone.get("name", "").lower():
                serp_zone = zone.get("name")
                break
        
        if not serp_zone and zones:
            serp_zone = zones[0].get("name")
            
        if not serp_zone:
            logger.warning("⚠️ [Bright Data] No active zones configured on this account. Using fallback SERP data core.")
            return get_mock_serp_data(query)
            
        logger.info(f"🎯 [Bright Data] Using Zone '{serp_zone}' to trigger Google SERP query: '{query}'...")
        
        # Step 3: Trigger SERP request
        payload = {
            "zone": serp_zone,
            "url": f"https://www.google.com/search?q={requests.utils.quote(query)}&hl=en&gl=us",
            "format": "json"
        }
        
        serp_response = requests.post(
            "https://api.brightdata.com/request",
            headers=headers,
            json=payload,
            timeout=20
        )
        
        if serp_response.status_code == 200:
            logger.info("✅ [Bright Data] Successfully retrieved live Google SERP context.")
            return serp_response.json()
        else:
            logger.warning(
                f"⚠️ [Bright Data] SERP API request returned code {serp_response.status_code}: {serp_response.text}. "
                "Using fallback SERP data core."
            )
            return get_mock_serp_data(query)

    except Exception as e:
        logger.warning(f"⚠️ [Bright Data] Error contacting API: {e}. Using fallback SERP data core.")
        return get_mock_serp_data(query)

def get_mock_serp_data(query):
    """
    Returns realistic structured SERP data to ensure the pipeline operates
    flawlessly in local development/trial mode.
    """
    query_lower = query.lower()
    
    # Check if this is a custom localized query (not one of the presets)
    presets = ["broadway", "world", "global", "usa", "uk", "england", "london", "india", "mumbai", "delhi", "japan", "tokyo", "hokkaido"]
    is_custom_local = not any(word in query_lower for word in presets)
    
    if is_custom_local:
        # Extract dynamic city name from query
        city = "Local Sector"
        if "in " in query_lower:
            parts = query.split("in ")
            if len(parts) > 1:
                city = parts[1].strip().title()
        elif "near " in query_lower:
            parts = query.split("near ")
            if len(parts) > 1:
                city = parts[1].strip().title()
                
        logger.info(f"ℹ️ [Bright Data Mock] Serving safe, non-emergency local telemetry for: {city}")
        return {
            "search_parameters": {
                "q": query,
                "engine": "google"
            },
            "organic_results": [
                {
                    "position": 1,
                    "title": f"Official Update: Aegis Sentinel Active Monitoring in {city}",
                    "link": f"https://emergency-news.local/{city.lower()}-safe-monitoring",
                    "snippet": f"Aegis Sentinel coordination center confirms active grid tracking for {city} sector. All sensor telemetry networks are reporting safe baseline parameters with zero active fires, gas leaks, or critical incidents."
                },
                {
                    "position": 2,
                    "title": f"{city} Municipal Readiness Hub Online",
                    "link": f"https://emergency-news.local/{city.lower()}-resource-hub",
                    "snippet": f"Municipal disaster coordination units in {city} have established a standby monitoring hub to track seasonal weather. Stations are equipped with standard safety equipment and are operating under normal standby."
                }
            ]
        }

    logger.info("ℹ️ [Bright Data Mock] Serving structured crisis news context from fallback SERP data:")
    return {
        "search_parameters": {
            "q": query,
            "engine": "google"
        },
        "organic_results": [
            {
                "position": 1,
                "title": "Breaking: Gas Leak and Small Fire at Broadway Street Service Station",
                "link": "https://emergency-news.local/broadway-street-gas-fire",
                "snippet": "Local fire dispatch has confirmed a gas leak leading to a fire at Broadway Street. Residents are advised to avoid the area. Safe zones established at Central Park."
            },
            {
                "position": 2,
                "title": "Central Park Set Up as Disaster Coordination and Safe Zone",
                "link": "https://emergency-news.local/central-park-safe-zone",
                "snippet": "Municipal emergency teams have set up medical tents and distribution points inside Central Park. This is currently marked as a secure SAFE_ZONE."
            },
            {
                "position": 3,
                "title": "5th Avenue Medical Hub Requests Additional Supplies",
                "link": "https://emergency-news.local/5th-avenue-resource-hub",
                "snippet": "First responders are requesting more resources (medical supplies, blankets, and water) at 5th Avenue coordination station."
            }
        ]
    }
