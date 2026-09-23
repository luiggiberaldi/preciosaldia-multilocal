with open("cierre_text.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

for line in lines:
    if "877,59" in line:
        print("Found 877,59 in:", line.strip())
