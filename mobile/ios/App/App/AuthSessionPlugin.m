#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(AuthSessionPlugin, "AuthSessionPlugin",
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
)
