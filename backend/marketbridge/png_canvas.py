"""Pure-standard-library PNG image renderer with zero third-party dependencies."""

import struct
import zlib


class Canvas:
    """Minimal 24-bit RGB bitmap canvas capable of drawing lines, rectangles,

    axes, and text markers, then encoding to valid PNG via zlib.
    """

    def __init__(self, width: int, height: int, bg_color: tuple[int, int, int] = (15, 23, 42)):
        self.width = width
        self.height = height
        self.bg_color = bg_color
        # 3 bytes per pixel: R, G, B
        self.pixels = bytearray(bg_color[0:3] * (width * height))

    def set_pixel(self, x: int, y: int, color: tuple[int, int, int]) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            idx = (y * self.width + x) * 3
            self.pixels[idx : idx + 3] = bytes(color[:3])

    def fill_rect(self, x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
        min_x, max_x = max(0, min(x0, x1)), min(self.width, max(x0, x1))
        min_y, max_y = max(0, min(y0, y1)), min(self.height, max(y0, y1))
        row = bytes(color[:3]) * (max_x - min_x)
        for y in range(min_y, max_y):
            idx = (y * self.width + min_x) * 3
            self.pixels[idx : idx + len(row)] = row

    def draw_line(
        self,
        x0: int,
        y0: int,
        x1: int,
        y1: int,
        color: tuple[int, int, int],
        width: int = 1,
    ) -> None:
        """Bresenham line algorithm with optional stroke thickness."""
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy

        while True:
            for wx in range(-width // 2, width // 2 + 1):
                for wy in range(-width // 2, width // 2 + 1):
                    self.set_pixel(x0 + wx, y0 + wy, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def to_png(self) -> bytes:
        """Encode the raw bitmap buffer into a valid PNG binary."""
        # PNG signature
        sig = b"\x89PNG\r\n\x1a\n"

        # IHDR chunk
        ihdr_data = struct.pack(">IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0)
        ihdr = self._make_chunk(b"IHDR", ihdr_data)

        # IDAT chunk: scanlines with filter byte 0 (None)
        raw_scanlines = bytearray()
        row_len = self.width * 3
        for y in range(self.height):
            raw_scanlines.append(0)  # filter type 0
            idx = y * row_len
            raw_scanlines.extend(self.pixels[idx : idx + row_len])

        compressed = zlib.compress(bytes(raw_scanlines), level=9)
        idat = self._make_chunk(b"IDAT", compressed)

        # IEND chunk
        iend = self._make_chunk(b"IEND", b"")

        return sig + ihdr + idat + iend

    def _make_chunk(self, chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        return length + chunk_type + data + crc
