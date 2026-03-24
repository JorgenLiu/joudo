import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const faviconPath = resolve(__dirname, "..", "..", "..", "web", "public", "favicon.svg");
const iconPngPath = join(__dirname, "icon.png");
const iconIcnsPath = join(__dirname, "icon.icns");
const trayIconPngPath = join(__dirname, "tray-icon.png");
const trayIconRgbaPath = join(__dirname, "tray-icon.rgba");

renderIcons();

function renderIcons() {
  rasterizeSvg(1024, iconPngPath);
  rasterizeSvg(44, trayIconPngPath);
  writeFileSync(trayIconRgbaPath, decodePngRgba(trayIconPngPath));
  buildIcns(iconIcnsPath);
}

function buildIcns(outputPath) {
  const iconsetDir = join(tmpdir(), `joudo-iconset-${Date.now()}.iconset`);
  mkdirSync(iconsetDir, { recursive: true });

  try {
    const sizes = [16, 32, 128, 256, 512];
    for (const size of sizes) {
      rasterizeSvg(size, join(iconsetDir, `icon_${size}x${size}.png`));
      rasterizeSvg(size * 2, join(iconsetDir, `icon_${size}x${size}@2x.png`));
    }

    runCommand("iconutil", ["-c", "icns", iconsetDir, "-o", outputPath]);
  } finally {
    rmSync(iconsetDir, { recursive: true, force: true });
  }
}

function rasterizeSvg(size, outputPath) {
  runCommand("sips", ["-z", String(size), String(size), "-s", "format", "png", faviconPath, "--out", outputPath]);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Command failed: ${command} ${args.join(" ")}`);
  }
}

function decodePngRgba(filePath) {
  const png = readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) {
    throw new Error(`Invalid PNG signature: ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    offset += 4;
    const type = png.toString("ascii", offset, offset + 4);
    offset += 4;
    const data = png.subarray(offset, offset + length);
    offset += length + 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Unsupported PNG format for ${filePath}: bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rgba = Buffer.alloc(width * height * bytesPerPixel);

  let inputOffset = 0;
  let outputOffset = 0;
  for (let row = 0; row < height; row++) {
    const filterType = inflated[inputOffset++];
    for (let column = 0; column < stride; column++) {
      const raw = inflated[inputOffset++];
      const left = column >= bytesPerPixel ? rgba[outputOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? rgba[outputOffset + column - stride] : 0;
      const upLeft = row > 0 && column >= bytesPerPixel ? rgba[outputOffset + column - stride - bytesPerPixel] : 0;

      let value;
      switch (filterType) {
        case 0:
          value = raw;
          break;
        case 1:
          value = (raw + left) & 0xff;
          break;
        case 2:
          value = (raw + up) & 0xff;
          break;
        case 3:
          value = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          value = (raw + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filterType} for ${filePath}`);
      }

      rgba[outputOffset + column] = value;
    }

    outputOffset += stride;
  }

  return rgba;
}

function paeth(left, up, upLeft) {
  const predictor = left + up - upLeft;
  const leftDistance = Math.abs(predictor - left);
  const upDistance = Math.abs(predictor - up);
  const upLeftDistance = Math.abs(predictor - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}
