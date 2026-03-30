import UIKit
import Capacitor

@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
  override func viewDidLoad() {
    super.viewDidLoad()

    // Avoid the brief black flash while the WKWebView spins up / loads remote content.
    // Keep this aligned with the web app boot screen background (#071327).
    let brandBackground = UIColor(red: 7.0/255.0, green: 19.0/255.0, blue: 39.0/255.0, alpha: 1.0)
    view.backgroundColor = brandBackground

    // CAPBridgeViewController exposes the underlying web view via the bridge.
    let webView = bridge?.webView
    webView?.isOpaque = false
    webView?.backgroundColor = brandBackground
    webView?.scrollView.backgroundColor = brandBackground
  }
}
