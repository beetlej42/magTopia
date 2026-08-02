import AppKit
import CoreImage
import Vision

enum ShadowRemovalError: Error {
    case usage
    case imageLoad
    case cgImage
    case noForeground
    case render
    case pngEncoding
}

guard CommandLine.arguments.count == 4 else {
    fputs("Usage: swift scripts/remove_asset_shadow.swift <input.png> <output.png> <mask.png>\n", stderr)
    throw ShadowRemovalError.usage
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let maskURL = URL(fileURLWithPath: CommandLine.arguments[3])
guard let image = NSImage(contentsOf: inputURL) else { throw ShadowRemovalError.imageLoad }
var proposedRect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    throw ShadowRemovalError.cgImage
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
try handler.perform([request])
guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
    throw ShadowRemovalError.noForeground
}

let pixelBuffer = try observation.generateScaledMaskForImage(
    forInstances: observation.allInstances,
    from: handler
)
let source = CIImage(cgImage: cgImage)
let mask = CIImage(cvPixelBuffer: pixelBuffer)
let background = CIImage(color: CIColor(red: 1, green: 0, blue: 1, alpha: 1)).cropped(to: source.extent)
guard let blend = CIFilter(name: "CIBlendWithMask") else { throw ShadowRemovalError.render }
blend.setValue(source, forKey: kCIInputImageKey)
blend.setValue(background, forKey: kCIInputBackgroundImageKey)
blend.setValue(mask, forKey: kCIInputMaskImageKey)
guard let composited = blend.outputImage?.cropped(to: source.extent) else { throw ShadowRemovalError.render }

let context = CIContext(options: [.useSoftwareRenderer: false])

func writePNG(_ image: CIImage, to url: URL) throws {
    guard let rendered = context.createCGImage(image, from: source.extent) else { throw ShadowRemovalError.render }
    let bitmap = NSBitmapImageRep(cgImage: rendered)
    guard let data = bitmap.representation(using: .png, properties: [:]) else { throw ShadowRemovalError.pngEncoding }
    try data.write(to: url)
}

try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try writePNG(composited, to: outputURL)
try writePNG(mask, to: maskURL)
print("instances=\(observation.allInstances.count) output=\(outputURL.path) mask=\(maskURL.path)")
