import urllib.request
import json

url = "https://www.canva.com/api/oembed?url=https://www.canva.com/design/DAHLIvrC8QA/view"

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        print("oEmbed Data:")
        print(json.dumps(data, indent=2))
except Exception as e:
    print("Error:", e)
