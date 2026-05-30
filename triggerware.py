import logging

logger = logging.getLogger("TriggerWare")

def trigger_action(workflow_id, payload):
    """
    Simulates TriggerWare workflow automation execution.
    Prints a beautiful alert log message.
    """
    msg = payload.get("msg", "")
    logger.info("*" * 60)
    logger.info(f"🚨 [TRIGGERWARE ACTION DEPLOYED]")
    logger.info(f"   Workflow ID : {workflow_id}")
    logger.info(f"   Payload     : {msg}")
    logger.info("*" * 60)
