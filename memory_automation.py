import json
import logging
from dotenv import load_dotenv
from cognee import cognify
from triggerware import trigger_action  # Conceptual automation execution

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

async def persist_and_alert(verified_json_string):
    try:
        structured_data = json.loads(verified_json_string)
    except Exception as e:
        logger.error(f"❌ Failed to parse verified JSON: {e}")
        return
    
    for item in structured_data:
        # 1. Use Cognee to ensure the agent remembers the safe-zone state over loops
        try:
            logger.info(f"🧠 [Cognee] Attempting to cognify: {item['location_name']} ({item['status']})")
            await cognify(item)
            logger.info("🧠 [Cognee] Data successfully persisted in graph memory.")
        except Exception as e:
            logger.warning(
                f"⚠️ [Cognee] Cognify skipped or mock-persisted. "
                f"Local DB or vector store environment not fully initialized. Error: {e}"
            )
            # Safe zone state mock log
            logger.info(f"💾 [Cognee Mock] Graph Node created: {item['location_name']} -> {item['status']}")
        
        # 2. Use TriggerWare to send immediate webhooks for high-priority hazards
        if item.get("status") == "HAZARD":
            trigger_action(
                workflow_id="emergency_slack_alert",
                payload={"msg": f"CRITICAL HAZARD DETECTED: {item.get('details')} at {item.get('location_name')}"}
            )
