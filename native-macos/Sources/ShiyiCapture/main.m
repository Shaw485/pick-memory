#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <sys/file.h>

static NSString *ShiyiSupportDirectory(void) {
    NSString *base = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    return [base stringByAppendingPathComponent:@"ShiyiCard"];
}

static BOOL AppendPendingCard(NSDictionary *card) {
    NSFileManager *manager = NSFileManager.defaultManager;
    NSString *directory = ShiyiSupportDirectory();
    if (![manager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil]) return NO;

    NSString *lockPath = [directory stringByAppendingPathComponent:@"pending.lock"];
    int descriptor = open(lockPath.fileSystemRepresentation, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR);
    if (descriptor < 0) return NO;
    flock(descriptor, LOCK_EX);

    NSString *queuePath = [directory stringByAppendingPathComponent:@"pending.json"];
    NSData *existingData = [NSData dataWithContentsOfFile:queuePath];
    NSArray *decoded = existingData ? [NSJSONSerialization JSONObjectWithData:existingData options:0 error:nil] : nil;
    NSMutableArray *cards = [decoded isKindOfClass:NSArray.class] ? [decoded mutableCopy] : [NSMutableArray array];
    [cards addObject:card];
    if (cards.count > 500) [cards removeObjectsInRange:NSMakeRange(0, cards.count - 500)];

    NSData *data = [NSJSONSerialization dataWithJSONObject:cards options:0 error:nil];
    BOOL success = [data writeToFile:queuePath options:NSDataWritingAtomic error:nil];
    flock(descriptor, LOCK_UN);
    close(descriptor);
    return success;
}

@interface ShiyiDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSPanel *panel;
@property(nonatomic, strong) NSButton *learnButton;
@property(nonatomic, strong) id mouseUpMonitor;
@property(nonatomic, strong) id mouseDownMonitor;
@property(nonatomic, strong) NSTimer *permissionTimer;
@property(nonatomic, copy) NSString *capturedText;
@property(nonatomic, copy) NSString *capturedSourceApp;
@property(nonatomic, copy) NSString *lastSelection;
@property(nonatomic, strong) NSDate *lastSelectionDate;
@property(nonatomic) BOOL captureEnabled;
@end

@implementation ShiyiDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.captureEnabled = YES;
    self.lastSelection = @"";
    self.lastSelectionDate = NSDate.distantPast;
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [self configurePanel];
    [self configureStatusItem];
    [self requestAccessibilityPermission];
    [self installEventMonitors];
    self.permissionTimer = [NSTimer scheduledTimerWithTimeInterval:4 repeats:YES block:^(__unused NSTimer *timer) {
        [self updateStatus];
    }];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.mouseUpMonitor) [NSEvent removeMonitor:self.mouseUpMonitor];
    if (self.mouseDownMonitor) [NSEvent removeMonitor:self.mouseDownMonitor];
    [self.permissionTimer invalidate];
}

- (void)configurePanel {
    self.panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 52, 26)
                                           styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                                             backing:NSBackingStoreBuffered
                                               defer:NO];
    self.panel.level = NSFloatingWindowLevel;
    self.panel.opaque = NO;
    self.panel.backgroundColor = NSColor.clearColor;
    self.panel.hasShadow = YES;
    self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                    NSWindowCollectionBehaviorFullScreenAuxiliary |
                                    NSWindowCollectionBehaviorTransient;

    NSVisualEffectView *background = [[NSVisualEffectView alloc] initWithFrame:self.panel.contentView.bounds];
    background.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    background.material = NSVisualEffectMaterialPopover;
    background.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    background.state = NSVisualEffectStateActive;
    background.wantsLayer = YES;
    background.layer.cornerRadius = 13;
    background.layer.masksToBounds = YES;
    [self.panel.contentView addSubview:background];

    self.learnButton = [[NSButton alloc] initWithFrame:background.bounds];
    self.learnButton.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.learnButton.title = @"学习";
    self.learnButton.bordered = NO;
    self.learnButton.font = [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold];
    self.learnButton.contentTintColor = [NSColor colorWithCalibratedRed:0.18 green:0.45 blue:0.33 alpha:1];
    self.learnButton.target = self;
    self.learnButton.action = @selector(learnSelection:);
    [background addSubview:self.learnButton];
}

- (void)configureStatusItem {
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
    self.statusItem.button.title = @"忆";
    NSMenu *menu = [NSMenu new];
    NSMenuItem *toggle = [[NSMenuItem alloc] initWithTitle:@"启用划词学习" action:@selector(toggleCapture:) keyEquivalent:@""];
    toggle.target = self;
    toggle.state = NSControlStateValueOn;
    [menu addItem:toggle];
    NSMenuItem *permission = [[NSMenuItem alloc] initWithTitle:@"打开辅助功能设置…" action:@selector(openAccessibilitySettings:) keyEquivalent:@""];
    permission.target = self;
    [menu addItem:permission];
    [menu addItem:NSMenuItem.separatorItem];
    NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"退出拾忆卡" action:@selector(quitApp:) keyEquivalent:@"q"];
    quit.target = self;
    [menu addItem:quit];
    self.statusItem.menu = menu;
    [self updateStatus];
}

- (void)installEventMonitors {
    __weak typeof(self) weakSelf = self;
    self.mouseUpMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseUp handler:^(__unused NSEvent *event) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.12 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [weakSelf captureSelection];
        });
    }];
    self.mouseDownMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown handler:^(__unused NSEvent *event) {
        [weakSelf.panel orderOut:nil];
    }];
}

- (void)captureSelection {
    if (!self.captureEnabled || !AXIsProcessTrusted()) return;

    AXUIElementRef systemWide = AXUIElementCreateSystemWide();
    CFTypeRef focusedValue = NULL;
    AXError focusedError = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute, &focusedValue);
    CFRelease(systemWide);
    if (focusedError != kAXErrorSuccess || !focusedValue) return;

    AXUIElementRef focusedElement = (AXUIElementRef)focusedValue;
    pid_t processID = 0;
    AXUIElementGetPid(focusedElement, &processID);
    NSString *sourceApp = [NSRunningApplication runningApplicationWithProcessIdentifier:processID].localizedName ?: @"其他应用";

    CFTypeRef subroleValue = NULL;
    AXUIElementCopyAttributeValue(focusedElement, kAXSubroleAttribute, &subroleValue);
    NSString *subrole = subroleValue && CFGetTypeID(subroleValue) == CFStringGetTypeID()
        ? (__bridge NSString *)subroleValue
        : @"";
    BOOL isSecureText = [subrole localizedCaseInsensitiveContainsString:@"secure"];
    if (subroleValue) CFRelease(subroleValue);
    if (isSecureText) {
        CFRelease(focusedValue);
        return;
    }

    CFTypeRef selectedValue = NULL;
    AXError selectedError = AXUIElementCopyAttributeValue(focusedElement, kAXSelectedTextAttribute, &selectedValue);
    if (selectedError != kAXErrorSuccess || !selectedValue) {
        CFRelease(focusedValue);
        [self captureSelectionThroughClipboardFromApp:sourceApp];
        return;
    }

    NSString *rawText = nil;
    if (CFGetTypeID(selectedValue) == CFStringGetTypeID()) {
        rawText = [(__bridge NSString *)selectedValue copy];
    } else if ([(__bridge id)selectedValue isKindOfClass:NSAttributedString.class]) {
        rawText = [(__bridge NSAttributedString *)selectedValue string];
    }
    if (!rawText) {
        CFRelease(selectedValue);
        CFRelease(focusedValue);
        [self captureSelectionThroughClipboardFromApp:sourceApp];
        return;
    }

    CFRelease(selectedValue);
    CFRelease(focusedValue);
    if (![self useSelectionText:rawText sourceApp:sourceApp]) {
        [self captureSelectionThroughClipboardFromApp:sourceApp];
    }
}

- (BOOL)useSelectionText:(NSString *)rawText sourceApp:(NSString *)sourceApp {
    NSString *text = [rawText stringByReplacingOccurrencesOfString:@"\\s+"
                                                         withString:@" "
                                                            options:NSRegularExpressionSearch
                                                              range:NSMakeRange(0, rawText.length)];
    text = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (text.length < 2 || ([text isEqualToString:self.lastSelection] && [NSDate.date timeIntervalSinceDate:self.lastSelectionDate] < 1.2)) {
        return NO;
    }
    self.lastSelection = text;
    self.lastSelectionDate = NSDate.date;
    self.capturedText = text.length > 5000 ? [text substringToIndex:5000] : text;
    self.capturedSourceApp = sourceApp;
    [self showPanelAt:NSEvent.mouseLocation];
    return YES;
}

- (void)captureSelectionThroughClipboardFromApp:(NSString *)sourceApp {
    if ([sourceApp isEqualToString:@"拾忆卡"]) return;
    NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
    NSMutableArray<NSPasteboardItem *> *snapshot = [NSMutableArray array];
    for (NSPasteboardItem *item in pasteboard.pasteboardItems ?: @[]) {
        NSPasteboardItem *copy = [NSPasteboardItem new];
        for (NSPasteboardType type in item.types) {
            NSData *data = [item dataForType:type];
            if (data) [copy setData:data forType:type];
        }
        [snapshot addObject:copy];
    }
    NSInteger previousChangeCount = pasteboard.changeCount;

    CGEventRef keyDown = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)8, true);
    CGEventRef keyUp = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)8, false);
    CGEventSetFlags(keyDown, kCGEventFlagMaskCommand);
    CGEventSetFlags(keyUp, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, keyDown);
    CGEventPost(kCGHIDEventTap, keyUp);
    CFRelease(keyDown);
    CFRelease(keyUp);

    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.14 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        NSString *copiedText = pasteboard.changeCount != previousChangeCount
            ? [pasteboard stringForType:NSPasteboardTypeString]
            : nil;
        [pasteboard clearContents];
        if (snapshot.count) [pasteboard writeObjects:snapshot];
        if (copiedText.length) [weakSelf useSelectionText:copiedText sourceApp:sourceApp];
    });
}

- (void)showPanelAt:(NSPoint)mouseLocation {
    self.learnButton.title = @"学习";
    self.learnButton.enabled = YES;
    [self.panel setContentSize:NSMakeSize(52, 26)];
    NSScreen *screen = NSScreen.mainScreen;
    for (NSScreen *candidate in NSScreen.screens) {
        if (NSPointInRect(mouseLocation, candidate.frame)) { screen = candidate; break; }
    }
    NSRect visible = screen.visibleFrame;
    NSPoint origin = NSMakePoint(mouseLocation.x - 26, mouseLocation.y + 9);
    origin.x = MIN(MAX(origin.x, NSMinX(visible) + 6), NSMaxX(visible) - 58);
    if (origin.y + 26 > NSMaxY(visible)) origin.y = mouseLocation.y - 35;
    origin.y = MAX(origin.y, NSMinY(visible) + 6);
    [self.panel setFrameOrigin:origin];
    [self.panel orderFrontRegardless];
}

- (void)learnSelection:(id)sender {
    if (!self.capturedText.length) return;
    self.learnButton.title = @"已加入 ✓";
    self.learnButton.enabled = NO;
    [self.panel setContentSize:NSMakeSize(70, 26)];

    NSCharacterSet *separator = [NSCharacterSet characterSetWithCharactersInString:@"。！？.!?\n"];
    NSString *title = [self.capturedText componentsSeparatedByCharactersInSet:separator].firstObject;
    if (title.length > 34) title = [[title substringToIndex:34] stringByAppendingString:@"…"];
    NSDictionary *card = @{
        @"id": NSUUID.UUID.UUIDString,
        @"title": title ?: @"未命名知识点",
        @"content": self.capturedText,
        @"sourceApp": self.capturedSourceApp ?: @"其他应用",
        @"createdAt": [NSISO8601DateFormatter.new stringFromDate:NSDate.date]
    };
    AppendPendingCard(card);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.85 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self.panel orderOut:nil];
    });
}

- (void)requestAccessibilityPermission {
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    [self updateStatus];
}

- (void)updateStatus {
    BOOL trusted = AXIsProcessTrusted();
    self.statusItem.button.toolTip = trusted ? @"拾忆卡：划词学习已就绪" : @"拾忆卡：需要辅助功能权限";
    NSString *directory = ShiyiSupportDirectory();
    [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSDictionary *status = @{
        @"trusted": @(trusted),
        @"enabled": @(self.captureEnabled),
        @"version": @"0.3.1",
        @"updatedAt": [NSISO8601DateFormatter.new stringFromDate:NSDate.date]
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:status options:0 error:nil];
    [data writeToFile:[directory stringByAppendingPathComponent:@"status.json"] options:NSDataWritingAtomic error:nil];
}

- (void)toggleCapture:(NSMenuItem *)sender {
    self.captureEnabled = !self.captureEnabled;
    sender.state = self.captureEnabled ? NSControlStateValueOn : NSControlStateValueOff;
    if (!self.captureEnabled) [self.panel orderOut:nil];
}

- (void)openAccessibilitySettings:(id)sender {
    NSURL *url = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"];
    [NSWorkspace.sharedWorkspace openURL:url];
}

- (void)quitApp:(id)sender { [NSApp terminate:nil]; }

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        ShiyiDelegate *delegate = [ShiyiDelegate new];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
