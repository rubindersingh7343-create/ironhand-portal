#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(ReceiptDocScannerPlugin, "ReceiptDocScanner",
    CAP_PLUGIN_METHOD(scan, CAPPluginReturnPromise);
)

