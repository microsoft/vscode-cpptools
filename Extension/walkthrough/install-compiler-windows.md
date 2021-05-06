1. Install the Microsoft Visual C++ (MSVC) compiler toolset.

   If you have a recent version of Visual Studio, open the Visual Studio Installer from the Windows Start menu and verify that the C++ workload is checked. If it's not installed, then check the box and click the **Modify** button in the installer.

   You can also install just the **C++ Build Tools**, without a full Visual Studio IDE installation. From the Visual Studio [Downloads](https://visualstudio.microsoft.com/downloads#other) page, scroll down until you see **Tools for Visual Studio** under the **All downloads** section and select the download for **Build Tools for Visual Studio**.

   ![Build Tools for Visual Studio download](images/msvc/build-tools-for-vs.png)

   This will launch the Visual Studio Installer, which will bring up a dialog showing the available Visual Studio Build Tools workloads. Check the **C++ build tools** workload and select **Install**.

   ![Cpp build tools workload](images/msvc/cpp-build-tools.png)

>**Note**: You can use the C++ toolset from Visual Studio Build Tools along with Visual Studio Code to compile, build, and verify any C++ codebase as long as you also have a valid Visual Studio license (either Community, Pro, or Enterprise) that you are actively using to develop that C++ codebase.

### Check your Microsoft Visual C++ installation

To use MSVC from a command line or VS Code, you must run from a **Developer Command Prompt for Visual Studio**. An ordinary shell such as PowerShell, Bash, or the Windows command prompt does not have the necessary path environment variables set.

To open the Developer Command Prompt for VS, start typing 'developer' in the Windows Start menu, and you should see it appear in the list of suggestions. The exact name depends on which version of Visual Studio or the Visual Studio Build Tools you have installed. Click on the item to open the prompt.

![Developer Command Prompt](images/msvc/developer-cmd-prompt-menu.png)

You can test that you have the C++ compiler, `cl.exe`, installed correctly by typing 'cl' and you should see a copyright message with the version and basic usage description.

![Checking cl.exe installation](images/msvc/check-cl-exe.png)

If the Developer Command Prompt is using the BuildTools location as the starting directory (you wouldn't want to put projects there), navigate to your user folder (`C:\users\{your username}\`) before you start creating new projects.
