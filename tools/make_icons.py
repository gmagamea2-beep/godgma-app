"""앱 아이콘(달) PNG를 만든다. 외부 라이브러리 없이 표준 라이브러리만 쓴다.

사용법: python tools/make_icons.py   (app 폴더에서 실행 → public/icons/ 에 생성)
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'public', 'icons')

BG = (0x0e, 0x0e, 0x14)
MOON = (0xa7, 0x8b, 0xfa)
SS = 4  # 계단 현상을 줄이기 위한 슈퍼샘플링 배수


def moon_coverage(x, y, scale):
    """(0~1 좌표) 점이 초승달 안에 있는지. scale 은 maskable 여백용 축소 비율."""
    cx, cy = 0.5 + (x - 0.5) / scale, 0.5 + (y - 0.5) / scale
    outer = (cx - 0.5) ** 2 + (cy - 0.5) ** 2 <= 0.30 ** 2
    inner = (cx - 0.62) ** 2 + (cy - 0.42) ** 2 <= 0.25 ** 2
    return outer and not inner


def render(size, scale, radius):
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG 필터 타입 0
        for px in range(size):
            hit = inside_bg = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    # 둥근 모서리 배경 (radius=0 이면 꽉 찬 사각형)
                    dx = max(radius - x, 0, x - (1 - radius))
                    dy = max(radius - y, 0, y - (1 - radius))
                    if radius == 0 or dx * dx + dy * dy <= radius * radius:
                        inside_bg += 1
                        if moon_coverage(x, y, scale):
                            hit += 1
            n = SS * SS
            a = inside_bg / n
            t = hit / max(inside_bg, 1)
            rgb = [round(BG[i] + (MOON[i] - BG[i]) * t) for i in range(3)]
            row += bytes(rgb + [round(a * 255)])
        rows.append(bytes(row))
    return b''.join(rows)


def write_png(path, size, scale, radius):
    raw = render(size, scale, radius)

    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('생성:', os.path.relpath(path, HERE))


def main():
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, 'icon-192.png'), 192, 1.0, 0.22)
    write_png(os.path.join(OUT, 'icon-512.png'), 512, 1.0, 0.22)
    # maskable: 안드로이드가 원·물방울 모양으로 자르므로 꽉 찬 배경 + 안전 영역(80%) 안에 달
    write_png(os.path.join(OUT, 'maskable-512.png'), 512, 0.78, 0)
    # iOS 홈 화면: 모서리는 iOS가 자르므로 꽉 찬 배경
    write_png(os.path.join(OUT, 'apple-touch-icon.png'), 180, 0.9, 0)


if __name__ == '__main__':
    main()
