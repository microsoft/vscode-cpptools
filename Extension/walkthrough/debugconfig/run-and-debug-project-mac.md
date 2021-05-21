# Run and debug your C++ file on macOS

To run and debug your C++ file in VS Code:

1. Open the C++ source file that you want to run and debug. Make sure this file is active (currently displayed and selected) in the editor.

2.  Press `F5`. Or, from the main menu, choose **Run > Start Debugging**.

3. Select **C++ (GDB/LLDB)**.

4. Choose **clang++ - Build and debug active file**.

After running and debugging your C++ file for the first time, you'll notice two new files inside your project's **.vscode** folder: **tasks.json** and **launch.json**.

For more complex build and debug scenarios, you can customize your build tasks and debug configurations in tasks.json and launch.json. For example, if you normally pass arguments to your compiler when building from the command line, you can specify those arguments in tasks.json using the **compilerArgs** property. Similarly, you can define arguments to pass to your program for debugging in launch.json.
