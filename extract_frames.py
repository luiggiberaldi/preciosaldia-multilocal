import cv2
import sys
import os

video_path = r"C:\Users\luigg\Desktop\2026\proyectos terminados\tasas al dia\abasto\WhatsApp Video 2026-03-23 at 5.42.44 PM.mp4"
output_dir = r"C:\Users\luigg\Desktop\2026\proyectos terminados\tasas al dia\abasto\frames"

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print("Error opening video")
    sys.exit()

# Get total frames
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)

print(f"Total frames: {total_frames}, FPS: {fps}")

# Extract 5 frames evenly spaced
for i in range(5):
    frame_idx = int(i * total_frames / 5)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    if ret:
        out_path = os.path.join(output_dir, f"frame_{i}.jpg")
        cv2.imwrite(out_path, frame)
        print(f"Saved {out_path}")

cap.release()
