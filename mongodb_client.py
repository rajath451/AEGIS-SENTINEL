import os
import secrets
import hashlib
import logging
from datetime import datetime
from dotenv import load_dotenv

# Load env configurations
load_dotenv()

logger = logging.getLogger("AEGISMongoDB")

# Initialize database variables
_mongo_client = None
db = None
use_fallback = False
_mock_db = {
    "operators": {},
    "mail_logs": []
}

# Load MONGO config
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "aegis_sentinel")

try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

    logger.info(f"🔌 Initializing MongoDB connection layer to: {MONGO_URI} [DB: {MONGO_DB_NAME}]")
    _mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    
    # Force a connection check to verify if the server is actively listening
    _mongo_client.admin.command('ping')
    db = _mongo_client[MONGO_DB_NAME]
    logger.info("✅ Secure MongoDB connection established successfully!")
    
except (ImportError, ConnectionFailure, ServerSelectionTimeoutError, Exception) as e:
    logger.warning(
        f"⚠️ MongoDB connection layer initialization failed: {e}. "
        f"Switching to secure Local Mock Memory Database fallback."
    )
    use_fallback = True

# --- CRYPTOGRAPHIC SECURITY HELPERS ---

def generate_salt():
    """Generates a secure random 32-character hexadecimal salt."""
    return secrets.token_hex(16)

def hash_password(password, salt):
    """Hashes a password with a cryptographic salt using SHA-256."""
    salted = password.encode('utf-8') + salt.encode('utf-8')
    return hashlib.sha256(salted).hexdigest()

def verify_password(password, salt, password_hash):
    """Verifies that a password matches the cryptographic hash using the same salt."""
    return hash_password(password, salt) == password_hash

# --- OPERATOR AUTHENTICATION OPERATIONS ---

def register_operator(email, password, role="AUTHORIZED OPERATOR • CLASS-1"):
    """
    Registers a new operator in the operators collection.
    Returns (success: bool, message: str)
    """
    email_clean = email.strip().lower()
    
    if use_fallback:
        if email_clean in _mock_db["operators"]:
            return False, "Registration Error: Email is already registered."
        
        salt = generate_salt()
        pwd_hash = hash_password(password, salt)
        
        _mock_db["operators"][email_clean] = {
            "_id": email_clean,
            "password_hash": pwd_hash,
            "salt": salt,
            "role": role,
            "last_localized_coords": None,
            "updated_at": datetime.utcnow().isoformat()
        }
        logger.info(f"💾 [Mock DB] Successfully registered secure profile for: {email_clean}")
        return True, "Successfully registered secure operator profile."
    
    try:
        operators = db["operators"]
        if operators.find_one({"_id": email_clean}):
            return False, "Registration Error: Email is already registered."
            
        salt = generate_salt()
        pwd_hash = hash_password(password, salt)
        
        operator_doc = {
            "_id": email_clean,
            "password_hash": pwd_hash,
            "salt": salt,
            "role": role,
            "last_localized_coords": None,
            "updated_at": datetime.utcnow().isoformat()
        }
        operators.insert_one(operator_doc)
        logger.info(f"🔥 [MongoDB] Successfully registered secure profile for: {email_clean}")
        return True, "Successfully registered secure operator profile."
    except Exception as e:
        logger.error(f"❌ MongoDB registration failure for {email_clean}: {e}")
        return False, f"Database Error: {str(e)}"

def authenticate_operator(email, password):
    """
    Validates operator credentials against the database.
    Returns (success: bool, operator_data: dict)
    """
    email_clean = email.strip().lower()
    
    if use_fallback:
        op = _mock_db["operators"].get(email_clean)
        if not op:
            return False, None
        
        if verify_password(password, op["salt"], op["password_hash"]):
            logger.info(f"💾 [Mock DB] Authorized credentials verified for operator: {email_clean}")
            return True, {
                "email": op["_id"],
                "role": op["role"]
            }
        logger.warning(f"🔒 [Mock DB] Authentication failed: invalid password hash match for: {email_clean}")
        return False, None

    try:
        operators = db["operators"]
        op = operators.find_one({"_id": email_clean})
        if not op:
            return False, None
            
        if verify_password(password, op["salt"], op["password_hash"]):
            logger.info(f"🔥 [MongoDB] Authorized credentials verified for operator: {email_clean}")
            return True, {
                "email": op["_id"],
                "role": op["role"]
            }
        logger.warning(f"🔒 [MongoDB] Authentication failed: invalid password hash match for: {email_clean}")
        return False, None
    except Exception as e:
        logger.error(f"❌ MongoDB authentication failure for {email_clean}: {e}")
        return False, None

# --- GEOCENTRIC LOCALIZATION COORDINATES STORAGE ---

def update_operator_coordinates(email, lat, lng):
    """
    Saves/Updates the last localized coordinates of an operator.
    Returns success: bool
    """
    email_clean = email.strip().lower()
    coords = {"lat": float(lat), "lng": float(lng)}
    timestamp = datetime.utcnow().isoformat()
    
    if use_fallback:
        op = _mock_db["operators"].get(email_clean)
        if op:
            op["last_localized_coords"] = coords
            op["updated_at"] = timestamp
            logger.info(f"💾 [Mock DB] Persisted localized coordinates for: {email_clean} -> {lat}, {lng}")
            return True
        return False

    try:
        operators = db["operators"]
        result = operators.update_one(
            {"_id": email_clean},
            {"$set": {"last_localized_coords": coords, "updated_at": timestamp}}
        )
        if result.matched_count > 0:
            logger.info(f"🔥 [MongoDB] Persisted localized coordinates for: {email_clean} -> {lat}, {lng}")
            return True
        return False
    except Exception as e:
        logger.error(f"❌ MongoDB coordinate update failure for {email_clean}: {e}")
        return False

def get_operator_coordinates(email):
    """
    Retrieves the last saved coordinates of an operator.
    Returns coords: dict or None
    """
    email_clean = email.strip().lower()
    
    if use_fallback:
        op = _mock_db["operators"].get(email_clean)
        if op:
            return op.get("last_localized_coords")
        return None

    try:
        operators = db["operators"]
        op = operators.find_one({"_id": email_clean}, {"last_localized_coords": 1})
        if op:
            return op.get("last_localized_coords")
        return None
    except Exception as e:
        logger.error(f"❌ MongoDB coordinate retrieval failure for {email_clean}: {e}")
        return None

# --- TRANSACTING PROXIMITY MAIL WARNING LOGS ---

def log_mail_warning(mail_data):
    """
    Stores mail proximity warning alert logs in the database.
    Returns success: bool
    """
    doc = dict(mail_data)
    doc["logged_at"] = datetime.utcnow().isoformat()
    
    if use_fallback:
        _mock_db["mail_logs"].append(doc)
        logger.info(f"💾 [Mock DB] Recorded security dispatch log to mail collection for operator: {doc.get('operatorEmail')}")
        return True
        
    try:
        mail_logs = db["mail_logs"]
        mail_logs.insert_one(doc)
        logger.info(f"🔥 [MongoDB] Recorded security dispatch log to mail_logs collection for operator: {doc.get('operatorEmail')}")
        return True
    except Exception as e:
        logger.error(f"❌ MongoDB log mail failure: {e}")
        return False
