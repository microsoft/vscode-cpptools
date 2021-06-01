# How To Debug MIEngine

MIEngine is one of the components used to enable the C/C++ debugging scenario with the Microsoft C/C++ extension with VS Code. This document is to help enable users who want to debug and contribute to MIEngine to fix issues or extend functionality. MIEngine is used to communicate with `gdb`/`lldb` using the MI protocol.

**Repository:** https://github.com/Microsoft/MIEngine

## To Build

To build MIEngine, you will either need Visual Studio 2015+ installed or at the very least [MSBuild](https://github.com/Microsoft/msbuild) installed. The configuration you want to build is `Desktop.Debug`.

You can open the solution file **MIDebugEngine.sln** located under **src** and change the configuration and build. You will want to look in the **bin\Desktop.Debug** folder for the compiled bits. You will need to copy the following files to your **.vscode\extensions\ms-vscode.cpptools-\<version\>\debugadapters\bin** folder in your users/home folder:

* Microsoft.MICore.dll
* Microsoft.MICore.XmlSerializers.dll
* Microsoft.MIDebugEngine.dll
* vscode\OpenDebugAD7.exe
* vscode\Microsoft.DebugEngineHost.dll
* vscode\Microsoft.VisualStudio.Shared.VSCodeDebugProtocol.dll

The symbol files are as follows:

**On Windows**
* Microsoft.MICore.pdb
* Microsoft.MIDebugEngine.pdb
* vscode\OpenDebugAD7.pdb
* vscode\Microsoft.DebugEngineHost.pdb

**On Linux/Mac**
* Microsoft.MICore.dll.mdb
* Microsoft.MIDebugEngine.dll.mdb
* vscode\OpenDebugAD7.exe.mdb
* vscode\Microsoft.DebugEngineHost.dll.mdb

### Debugging On Windows

On Windows, the easiest way to debug is to use Visual Studio. Locate the **src\Debugger\extension.ts** file in the **Extension** folder and open it in an editor.

If you are not building the extension, Locate the **out\src\Debugger\extension.ts** file in the **.vscode\extensions\ms-vscode.cpptools** folder and open it in an editor.

Locate the following lines:
```json
return {
    command: command
};
```
and add the following line to the object:
```json
args: ["--pauseForDebugger"]
```

This will cause the debugger to look like it has hung once you start debugging, but in reality it is waiting for a debugger to attach. Set your breakpoints and attach your debugger to the `OpenDebugAD7.exe` process. Once the debugger is attached, VS Code should start debugging and you can reproduce your scenario.

### Debugging MIEngine running on Linux or macOS

#### With MonoDevelop

On Linux and macOS, we use `mono` as our framework. You can download Xamarin Studio v5.10.1.6 and remotely attach to your Mac or Linux box to debug there.

##### Install Prerequisites
1. Install [GTK](http://www.mono-project.com/download/).
2. Install [Xamarin Studio v5.10.1.6](http://download.xamarin.com/studio/Windows/XamarinStudio-5.10.1.6-0.msi).

Remote attach functionality behind a flag.  You can run it like this:
```PowerShell
cd "\Program Files (x86)\MonoDevelop\bin"
set MONODEVELOP_SDB_TEST=1
MonoDevelop.exe
```

##### Create an empty project for attaching (one-time setup)

1. Launch MonoDevelop.
2. File -> New Solution.
3. Misc/Generic Project.
4. Name project and hit "Create".
5. Right-click the project node (blue square) and do "Options".
6. Under Run -> Custom Commands, select "Execute" in the lower dropdown and choose a command (I use `c:\windows\notepad.exe` - it doesn't matter what the command is, but MonoDevelop requires it to exist before it'll light up the Run menu).

##### Configure the extension to enable remote debugging

Open the **~/.vscode/extensions/ms-vscode.cpptools-\<version\>/debugAdapters/OpenDebugAD7** file with a text editor and locate and uncomment the line at the bottom. When you start debugging, it will now hang until the remote debugger is attached from Xamarin Studio.

##### Attach the remote debugger

In MonoDevelop: Run -> Run With -> Custom Command Mono Soft Debugger.
Fill in the IP and port of the Linux/macOS machine and hit "Connect" to start debugging.

After you've done this once, you can hit the MonoDevelop "Play" button or <kbd>F5</kbd> to bring up the connect dialog again.

#### With VS Code + Mono Debug

##### Install Prerequisites
1. Install [VS Code](https://code.visualstudio.com/Download).
2. Install Mono Debug extension for VS Code.

##### Create an empty project (one-time setup)
1. Open to a new folder and create `.vscode/launch.json`.
2. Create the following configuration in launch.json.
```
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Attach to Mono",
            "request": "attach",
            "type": "mono",
            "address": "<INSERT_MACHINE_IP_ADDRESS_HERE>",
            "port": 1234
        }
    ]
}
```

##### Configure the extension to enable remote debugging

Open the **~/.vscode/extensions/ms-vscode.cpptools-\<version\>/debugAdapters/OpenDebugAD7** file with a text editor and locate and uncomment the line at the bottom. When you start debugging, it will now hang until the remote debugger is attached from VS Code.

##### Attach the remote debugger

Select the `Attach to Mono` configuration and hit F5.

#### Additional Notes

Note: If you are debugging to CentOS, you will need to make an exception in the firewall.
* `sudo firewall-cmd --zone=public --add-port=1234/tcp --permanent`
* `sudo firewall-cmd --reload`
