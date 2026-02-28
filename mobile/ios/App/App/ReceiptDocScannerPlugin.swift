import Capacitor
import Foundation
import UIKit
import VisionKit

@objc(ReceiptDocScannerPlugin)
public class ReceiptDocScannerPlugin: CAPPlugin, VNDocumentCameraViewControllerDelegate {
    private var currentCall: CAPPluginCall?

    @objc public func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Document scanner is not supported on this device.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.currentCall = call

            let vc = VNDocumentCameraViewController()
            vc.delegate = self
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        currentCall?.reject("cancelled")
        currentCall = nil
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        currentCall?.reject(error.localizedDescription)
        currentCall = nil
    }

    public func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        controller.dismiss(animated: true)
        guard let call = currentCall else { return }
        currentCall = nil

        let pageCount = scan.pageCount
        guard pageCount > 0 else {
            call.reject("No pages captured.")
            return
        }

        // Pick the "best" page: highest pixel count.
        var bestIndex = 0
        var bestPixels = 0
        for i in 0..<pageCount {
            let img = scan.imageOfPage(at: i)
            let pixels = Int(img.size.width * img.scale * img.size.height * img.scale)
            if pixels > bestPixels {
                bestPixels = pixels
                bestIndex = i
            }
        }

        let image = scan.imageOfPage(at: bestIndex)
        let processed = resizeIfNeeded(image: image, maxWidth: 2200)
        guard let jpeg = encodeJpegUnder8mb(image: processed) else {
            call.reject("Unable to encode scan.")
            return
        }

        let base64 = jpeg.base64EncodedString()
        call.resolve([
            "imageDataUrl": "data:image/jpeg;base64,\(base64)",
            "pages": pageCount,
            "pageIndex": bestIndex,
            "width": Int(processed.size.width),
            "height": Int(processed.size.height)
        ])
    }

    private func resizeIfNeeded(image: UIImage, maxWidth: CGFloat) -> UIImage {
        let width = image.size.width
        if width <= maxWidth { return image }
        let scale = maxWidth / max(width, 1)
        let newSize = CGSize(width: maxWidth, height: image.size.height * scale)
        UIGraphicsBeginImageContextWithOptions(newSize, true, 1.0)
        image.draw(in: CGRect(origin: .zero, size: newSize))
        let out = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return out ?? image
    }

    private func encodeJpegUnder8mb(image: UIImage) -> Data? {
        // Try quality steps until we're under ~8MB.
        let maxBytes = 8 * 1024 * 1024
        var quality: CGFloat = 0.92
        var data = image.jpegData(compressionQuality: quality)
        var tries = 0
        while let d = data, d.count > maxBytes, tries < 6 {
            quality = max(0.6, quality - 0.06)
            data = image.jpegData(compressionQuality: quality)
            tries += 1
        }
        return data
    }
}

