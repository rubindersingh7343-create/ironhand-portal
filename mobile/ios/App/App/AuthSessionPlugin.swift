import AuthenticationServices
import Capacitor
import Foundation

@objc(AuthSessionPlugin)
public class AuthSessionPlugin: CAPPlugin {
    private var session: ASWebAuthenticationSession?

    @objc public func start(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid url")
            return
        }

        let callbackScheme = call.getString("callbackScheme")

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callbackURL, error in
                if let error = error {
                    call.reject("Authentication failed: \(error.localizedDescription)")
                    return
                }
                call.resolve([
                    "callbackUrl": callbackURL?.absoluteString ?? ""
                ])
            }

            if #available(iOS 13.0, *) {
                self.session?.presentationContextProvider = self
            }
            self.session?.prefersEphemeralWebBrowserSession = false
            self.session?.start()
        }
    }
}

@available(iOS 13.0, *)
extension AuthSessionPlugin: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
