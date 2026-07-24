import Capacitor

@objc(TaskNotesViewController)
public final class TaskNotesViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolderAccessPlugin())
    }
}
