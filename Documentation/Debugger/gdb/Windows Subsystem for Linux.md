# Windows 10's Windows Subsystem for Linux
With the release of Windows 10 Creators Update, you will now be able to use Visual Studio Code and the Microsoft C/C++ extension to debug your `Windows Subsystem for Linux (WSL)` [Bash on Ubuntu](https://msdn.microsoft.com/en-us/commandline/wsl/about) projects.

Code can be written on Windows itself using VSCode and debugged through `bash.exe` to the Bash on Windows layer. 

**NOTE: Creator's Update is required due to bugfixes within the subsystem that we rely on to provide debugging. Debugging using a previous version of WSL is unsupported and likely will not work.**

## Prerequisites
* [Windows 10 Creators Update with Windows Subsystem for Linux and Bash](https://msdn.microsoft.com/en-us/commandline/wsl/install_guide) installed.
* Install g++/gcc and gdb within `WSL` to allow compiling and debugging. You can use the package manager to do this. For example, to install g++, you can run `sudo apt install g++` in the Bash window.
* [Visual Studio Code](https://code.visualstudio.com) + Microsoft C/C++ extension for VSCode.

## How-To
To debug, commands will be routed from Windows through `bash.exe` to set up debugging. Because our extension runs as a 32-bit process, it will need to use the `C:\Windows\SysNative` folder to access the `bash.exe` executable that is normally in `C:\Windows\System32`. We will be using the `"pipeTransport"` ability within the extension to do debugging and `"sourceFileMap"` to map the source from the subsystem's paths back to Windows path. 

**NOTE: Applications will need to be compiled in the `Windows Subsystem for Linux (WSL)` prior to debugging.**

### Example `launch.json` for Launching

In the following example, I have a local drive, `Z:\` that has my source code within windows for an app called kitchensink. I have set up the `"program"` and `"cwd"` paths to point to the directory within `WSL`. I have set up the `"pipeTransport"` to use `bash.exe`. I have also set up a `"sourceFileMap"` to have everything that is returned by `gdb` that starts with `/mnt/z` to point to `Z:\\` in Windows.

```
        {
            "name": "C++ Launch",
            "type": "cppdbg",
            "request": "launch",
            "program": "/mnt/z/Bash/kitchensink/a.out",
            "args": ["-fThreading"],
            "stopAtEntry": false,
            "cwd": "/mnt/z/Bash/kitchensink",
            "environment": [],
            "externalConsole": true,
            "windows": {
                "MIMode": "gdb",
                "setupCommands": [
                    {
                        "description": "Enable pretty-printing for gdb",
                        "text": "-enable-pretty-printing",
                        "ignoreFailures": true
                    }
                ]
            }, 
            "pipeTransport": {
                "pipeCwd": "",
                "pipeProgram": "c:\\windows\\sysnative\\bash.exe",
                "pipeArgs": ["-c"],
                "debuggerPath": "/usr/bin/gdb"
            },
            "sourceFileMap": {
                "/mnt/z": "z:\\"
            }
        }
```

### Example `launch.json` for Attaching to an Existing Process

This configuration similar to the launch process above. I have chosen to start the same application above from the Bash command line and now I want to attach to it for debugging. I have changed the `"processID"` to use the remote process picker by specifying the command `"${command:pickRemoteProcess}"` and set up the same `"sourceFileMap"`. When I press F5 to attach, I get a picker drop down showing the running processes within `WSL`. I can scroll or search for the process I want to attach to and start debugging.

```
        {
            "name": "C++ Attach",
            "type": "cppdbg",
            "request": "attach",
            "program": "/mnt/z/Bash/kitchensink/a.out",
            "processId": "${command:pickRemoteProcess}",
            "windows": {
                "MIMode": "gdb",
                "setupCommands": [
                    {
                        "description": "Enable pretty-printing for gdb",
                        "text": "-enable-pretty-printing",
                        "ignoreFailures": true
                    }
                ]
            },
            "pipeTransport": {
                "pipeCwd": "",
                "pipeProgram": "c:\\windows\\sysnative\\bash.exe",
                "pipeArgs": ["-c"],
                "debuggerPath": "/usr/bin/gdb"
            },
            "sourceFileMap": {
                "/mnt/z": "z:\\"
            }
        }
```