import asyncio
import logging
from dotenv import load_dotenv
from voice_engine import process_crisis_audio
from data_core import fetch_live_crisis_data
from brain_engine import verify_and_extract_coordinates
from memory_automation import persist_and_alert

# Load environment variables from .env
load_dotenv()

# Setup clean, visible logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("CrisisPipeline")

async def run_crisis_pipeline():
    logger.info("================================================================================")
    logger.info("🚀 STARTING CRISIS pipeline (Bright Data, Speechmatics, AIML-API, Cognee, TriggerWare)")
    logger.info("================================================================================")

    # 1. Transcribe the raw dispatch audio logs via Speechmatics
    logger.info("🎙️ [STEP 1] Ingesting live audio broadcast feed...")
    audio_file = "emergency_radio_clip.mp3"
    
    try:
        audio_transcript = process_crisis_audio(audio_file)
    except FileNotFoundError:
        logger.error(f"❌ Audio file '{audio_file}' not found.")
        logger.info("💡 To run the full pipeline, please make sure 'emergency_radio_clip.mp3' exists.")
        raise
    
    logger.info("🔊 Speechmatics Transcription Output:")
    logger.info(f"--- START TRANSCRIPT ---\n{audio_transcript}\n--- END TRANSCRIPT ---\n")
    
    # 2. Query Bright Data SERP API for real-time validation context
    logger.info("🌐 [STEP 2] Launching Bright Data SERP API Data Core query...")
    # Extract coordinates/context search query from dispatch
    search_query = "emergency response Broadway Street fire disaster"
    live_web_context = fetch_live_crisis_data(search_query)
    
    logger.info("🧠 [STEP 3] Analyzing data integrity and cross-referencing truth via Gemini...")
    # 3. Extract structured data objects via AI/ML API, passing the web search context
    verified_insights = verify_and_extract_coordinates(audio_transcript, live_web_context)
    logger.info("🎯 Verified Engine Output (Structured JSON):")
    logger.info(f"\n{verified_insights}\n")
    
    # 4. Store states inside Cognee memory and execute TriggerWare pipelines
    logger.info("💾 [STEP 4] Committing data to Cognee memory and evaluating TriggerWare conditions...")
    await persist_and_alert(verified_insights)
    
    logger.info("================================================================================")
    logger.info("✅ CRISIS PIPELINE CYCLE COMPLETED SUCCESSFULLY!")
    logger.info("================================================================================")

if __name__ == "__main__":
    asyncio.run(run_crisis_pipeline())
