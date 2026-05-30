with open(r"d:\id3\web\index.html", 'r', encoding='utf-8') as f:
    lines = f.readlines()
for line_idx, line in enumerate(lines, 1):
    if "settings-toggle-btn" in line:
        print(f"{line_idx}: {line.strip()}")
        # print 5 lines before and after
        for i in range(max(0, line_idx - 6), min(len(lines), line_idx + 5)):
            print(f"  {i+1}: {lines[i]}", end='')
