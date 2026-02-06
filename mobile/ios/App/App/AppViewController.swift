import Capacitor
import UIKit
import WebKit

class AppViewController: CAPBridgeViewController, WKNavigationDelegate {
    private let fallbackURL = URL(string: "https://ironhand.net/auth/login")!
    private var errorOverlay: UIView?

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.navigationDelegate = self
        enableScrollBounce()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        enableScrollBounce()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        enableScrollBounce()
        ensureInitialLoad()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        enableScrollBounce()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        clearErrorOverlay()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showErrorOverlay(message: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showErrorOverlay(message: error.localizedDescription)
    }

    private func enableScrollBounce() {
        guard let scrollView = webView?.scrollView else { return }
        scrollView.bounces = true
        scrollView.alwaysBounceVertical = true
        scrollView.alwaysBounceHorizontal = false
        scrollView.isScrollEnabled = true
    }

    private func ensureInitialLoad() {
        guard let webView = webView else { return }
        let current = webView.url?.absoluteString ?? ""
        if current.isEmpty || current == "about:blank" {
            webView.load(URLRequest(url: fallbackURL))
        }
    }

    private func showErrorOverlay(message: String) {
        guard errorOverlay == nil else { return }
        let overlay = UIView(frame: view.bounds)
        overlay.backgroundColor = UIColor(red: 0.05, green: 0.08, blue: 0.16, alpha: 1)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let titleLabel = UILabel()
        titleLabel.text = "Unable to load Iron Hand"
        titleLabel.textColor = .white
        titleLabel.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        let detailLabel = UILabel()
        detailLabel.text = message
        detailLabel.textColor = UIColor(white: 0.8, alpha: 1)
        detailLabel.font = UIFont.systemFont(ofSize: 13)
        detailLabel.numberOfLines = 0
        detailLabel.translatesAutoresizingMaskIntoConstraints = false

        let retryButton = UIButton(type: .system)
        retryButton.setTitle("Retry", for: .normal)
        retryButton.setTitleColor(.white, for: .normal)
        retryButton.backgroundColor = UIColor(red: 0.16, green: 0.35, blue: 0.85, alpha: 1)
        retryButton.layer.cornerRadius = 12
        retryButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 20, bottom: 10, right: 20)
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.addTarget(self, action: #selector(handleRetry), for: .touchUpInside)

        overlay.addSubview(titleLabel)
        overlay.addSubview(detailLabel)
        overlay.addSubview(retryButton)
        view.addSubview(overlay)
        errorOverlay = overlay

        NSLayoutConstraint.activate([
            titleLabel.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -40),
            detailLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            detailLabel.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            detailLabel.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 28),
            detailLabel.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -28),
            retryButton.topAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: 24),
            retryButton.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
        ])
    }

    @objc private func handleRetry() {
        clearErrorOverlay()
        if let webView = webView {
            webView.load(URLRequest(url: fallbackURL))
        }
    }

    private func clearErrorOverlay() {
        errorOverlay?.removeFromSuperview()
        errorOverlay = nil
    }
}
