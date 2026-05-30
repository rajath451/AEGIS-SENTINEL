import os
import json
import logging
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

# Custom AlternativeAIClient adapter subclassing OpenAI
# Bypasses the buggy aiml-api package validation while hitting the same servers.
class AlternativeAIClient(OpenAI):
    def __init__(self, api_key, **kwargs):
        super().__init__(
            base_url="https://api.aimlapi.com/v1",
            api_key=api_key,
            **kwargs
        )

def verify_and_extract_coordinates(raw_text_input, web_context_input=None, search_query=""):
    api_key = os.getenv("AIML_API_KEY")
    if not api_key:
        raise ValueError("AIML_API_KEY is not set in environment or .env file.")

    # Initialize your partner API layer
    client = AlternativeAIClient(api_key=api_key)
    
    web_context_str = (
        json.dumps(web_context_input, indent=2)
        if web_context_input
        else "No live web data core context available."
    )
    
    prompt = f"""
    You are an emergency verification engine. Analyze the following live input data stream, active search query, and cross-reference with live web search results:
    
    --- ACTIVE SEARCH QUERY ---
    {search_query}
    
    --- LIVE INPUT TRANSCRIPT ---
    {raw_text_input}
    
    --- LIVE WEB CONTEXT (BRIGHT DATA SERP API) ---
    {web_context_str}
    
    ---
    Tasks:
    1. Discard unverified rumors or vague hearsay.
    2. Cross-reference the live transcript with live web context to verify authenticity.
    3. Extract ONLY confirmed, firsthand eyewitness updates containing a location and operational status. If the transcript is silent, brief, or lacks specific locations, but the ACTIVE SEARCH QUERY refers to a specific city or region (e.g. "mangaluru"), extract that city/region as an emergency hazard or safe zone node based on details inside the web context or search query.
    4. Provide the absolute best-guess geographic coordinate latitude and longitude (lat and lng as decimal float values) for each extracted location based on your global knowledge database so they can be plotted directly on standard maps.
    5. Draft or extract critical, actionable safety precautions, prevention guidelines, or safety measures (safety precautions) for citizens and first responders in that area. Limit the precautions text to 1-2 concise sentences.
    
    Return your output strictly as a valid JSON list matching this blueprint schema:
    [
      {{"location_name": "string", "status": "SAFE_ZONE" | "HAZARD" | "RESOURCE", "details": "string", "lat": float, "lng": float, "precautions": "string"}}
    ]
    """
    
    logger.info("🧠 Sending transcript and Bright Data SERP context to Gemini 3 Flash Preview for reasoning...")
    response = client.chat.completions.create(
        model="google/gemini-3-flash-preview",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content
