import Foundation
import UIKit
import Capacitor

@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
  private var splashOverlay: UIImageView?
  private var progressObserver: NSKeyValueObservation?
  private var loadingObserver: NSKeyValueObservation?
  private var splashFallbackTimer: Timer?
  private var hasHiddenSplash = false

  override func viewDidLoad() {
    super.viewDidLoad()

    // Avoid the brief black flash while the WKWebView spins up / loads remote content.
    // Keep this aligned with the web app boot screen background (#071327).
    let brandBackground = UIColor(red: 7.0/255.0, green: 19.0/255.0, blue: 39.0/255.0, alpha: 1.0)
    view.backgroundColor = brandBackground

    let webView = self.webView
    webView?.isOpaque = false
    webView?.backgroundColor = brandBackground
    webView?.scrollView.backgroundColor = brandBackground

    showNativeSplashOverlay()
    observeInitialWebLoad()
  }

  private func showNativeSplashOverlay() {
    guard splashOverlay == nil else { return }
    guard let splashImage = UIImage(named: "Splash") else { return }

    let overlay = UIImageView(image: splashImage)
    overlay.contentMode = .scaleAspectFill
    overlay.frame = view.bounds
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.isUserInteractionEnabled = false
    overlay.alpha = 1.0
    view.addSubview(overlay)
    splashOverlay = overlay
  }

  private func observeInitialWebLoad() {
    guard let webView = self.webView else { return }
    if hasHiddenSplash { return }

    // Hide as soon as either the first navigation finishes or progress indicates content is drawn.
    progressObserver = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
      guard let self = self else { return }
      if webView.estimatedProgress >= 0.25 {
        self.hideNativeSplashOverlay()
      }
    }

    loadingObserver = webView.observe(\.isLoading, options: [.new]) { [weak self] webView, _ in
      guard let self = self else { return }
      if webView.isLoading == false {
        self.hideNativeSplashOverlay()
      }
    }

    splashFallbackTimer?.invalidate()
    splashFallbackTimer = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: false) { [weak self] _ in
      self?.hideNativeSplashOverlay(force: true)
    }
  }

  private func hideNativeSplashOverlay(force: Bool = false) {
    if hasHiddenSplash { return }
    guard let overlay = splashOverlay else { return }

    hasHiddenSplash = true
    progressObserver = nil
    loadingObserver = nil
    splashFallbackTimer?.invalidate()
    splashFallbackTimer = nil

    let duration: TimeInterval = force ? 0.12 : 0.22
    UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseOut], animations: {
      overlay.alpha = 0.0
    }, completion: { _ in
      overlay.removeFromSuperview()
    })
  }
}
