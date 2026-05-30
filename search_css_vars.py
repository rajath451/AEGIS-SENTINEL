import re

filepath = r"d:\id3\web\index.css"
pattern = re.compile(r"--[a-zA-Z0-9_-]+\s*:", re.IGNORECASE)

try:
    with open(filepath, 'r', encoding='utf-8') as f:
        for line_idx, line in enumerate(f, 1):
            if pattern.search(line):
                print(f"{line_idx}: {line.strip()}")
except Exception as e:
    print(f"Error: {e}")
