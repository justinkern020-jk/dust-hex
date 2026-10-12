"""Find where each unit's face sits in its 2:3 card art, so board coins can crop the
portrait on the face and upper body. Writes src/data/coinfaces.json:
  { cardId: [cx, cy, z] }  (cx, cy = crop centre as a fraction of the art; z = zoom
  relative to a plain cover crop of the art into a circle)
Faces are found with OpenCV's YuNet detector; art with no face found (cryptids,
beasts) falls back to the upper centre of the picture. Hand fixes go in OVERRIDE.
Run: python3 scripts/coin-faces.py [path/to/face_detection_yunet_2023mar.onnx]
(needs opencv-python >= 4.8; the model is from github.com/opencv/opencv_zoo)
"""
import json, os, sys
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cards = json.load(open(os.path.join(ROOT, 'src/data/cards.json')))
MODEL = sys.argv[1] if len(sys.argv) > 1 else '/workspace/models/yunet.onnx'
FALLBACK = [0.5, 0.36, 1.25]
# Hand-placed crops for art with no human face up front (cryptids, horses, scenes).
OVERRIDE = {
    'cinder-rider': [0.4, 0.42, 1.4], 'riderless': [0.5, 0.45, 1.2], 'night-watch': [0.55, 0.32, 1.5],
    'hang-fire': [0.55, 0.22, 1.5], 'ridge-listener': [0.45, 0.45, 1.6], 'pony-herd': [0.5, 0.45, 1.1],
    'empty-lodge': [0.55, 0.55, 1.4], 'empty-guidon': [0.45, 0.35, 1.2], 'last-sentry': [0.45, 0.4, 1.5],
    'picket-line': [0.5, 0.42, 1.2], 'empty-saddle': [0.5, 0.55, 1.2], 'thunderbird': [0.5, 0.4, 1.2],
    'piasa': [0.5, 0.32, 1.2], 'tommyknockers': [0.6, 0.45, 1.4], 'cactus-cat': [0.55, 0.45, 1.3],
    'hodag': [0.45, 0.4, 1.3], 'mothman': [0.45, 0.35, 1.3], 'black-dog': [0.5, 0.45, 1.3],
    'damned-thing': [0.5, 0.4, 1.0], 'bear-lake': [0.55, 0.32, 1.4], 'hidebehind': [0.4, 0.45, 1.3],
    'sleepy-hollow': [0.45, 0.4, 1.3], 'leeds-devil': [0.45, 0.35, 1.3], 'black-bart': [0.5, 0.22, 1.6],
    'jackalope': [0.45, 0.45, 1.5], 'alferd-packer': [0.45, 0.4, 1.5], 'resurrection-man': [0.4, 0.4, 1.4],
    'hearse-driver': [0.5, 0.45, 1.3], 'organist': [0.4, 0.45, 1.5], 'bill-mcdonald': [0.45, 0.45, 1.5],
    'comanche-horse': [0.55, 0.4, 1.3], 'crazy-horse': [0.55, 0.3, 1.5], 'hail-caller': [0.5, 0.45, 1.5],
}
out, misses = {}, []
for c in cards:
    if c['kind'] not in ('unit', 'leader'):
        continue
    img = cv2.imread(os.path.join(ROOT, 'public', c['art'].lstrip('/')))
    if img is None:
        misses.append(c['id']); out[c['id']] = FALLBACK; continue
    h, w = img.shape[:2]
    sh = int(h * 640 / w)
    small = cv2.resize(img, (640, sh))
    det = cv2.FaceDetectorYN.create(MODEL, '', (640, sh), 0.6, 0.3, 50)
    _, faces = det.detect(small)
    best = None
    for f in faces if faces is not None else []:
        x, y, fw, fh, score = f[0] / 640, f[1] / sh, f[2] / 640, f[3] / sh, f[-1]
        cy = y + fh / 2
        if cy > 0.72 or fw < 0.05:
            continue
        rank = score * fw * (1.3 - cy)
        if not best or rank > best[0]:
            best = (rank, x, y, fw, fh)
    if not best:
        misses.append(c['id']); out[c['id']] = FALLBACK; continue
    _, x, y, fw, fh = best
    cx, cy = x + fw / 2, y + fh / 2
    # Head and shoulders: the face takes about 40% of the coin across.
    z = max(1.0, min(2.6, 0.40 / fw))
    # Sit the face a little above centre, so the hat and the collar both show.
    out[c["id"]] = [round(float(cx), 3), round(float(min(0.75, cy + 0.06 / z)), 3), round(float(z), 2)]
out.update(OVERRIDE)
json.dump(out, open(os.path.join(ROOT, 'src/data/coinfaces.json'), 'w'), indent=0, sort_keys=True)
left = [m for m in misses if m not in OVERRIDE]
print(f'{len(out)} portraits; {len(misses) - len(left)} placed by hand; on the fallback crop: {", ".join(left) or "none"}', file=sys.stderr)
