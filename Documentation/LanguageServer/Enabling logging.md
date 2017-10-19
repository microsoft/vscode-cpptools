# How to enable logging in the extension

If you are experiencing a problem that we are unable to diagnose based on information in your issue report, we might ask you to enable logging and send us your logs.

As of version 0.14.0 of the extension, logging information is now delivered directly to the Output window in VSCode. To turn on full logging for an issue report, add `"C_Cpp.loggingLevel": "Information"` to your settings.json.

#### Old information (it still works, but is no longer recommended):

~~Logging is controlled by environment variables and is disabled by default. To enable logging, launch VS Code from an environment that contains the following variables:~~

```
VSCODE_CPP_LOGDIR=c:\path\to\logfolder
VSCODE_CPP_LOGFILE_LEVEL=5
```

~~When you open your folder in VS Code, we will create a vscode.cpp.log.\<pid\>.txt file for each extension process launched (\<pid\> = process id).~~

~~The log file level is a number that determines how much detail we'll log. Level 5 is generally detailed enough to give us information about what is going on in your session. We don't recommend you set this higher than 7 since the log quickly becomes cluttered with information that doesn't really help us diagnose your issues and actually makes it harder for us to spot problems. It may also slow down the extension considerably and make it harder for you to reproduce your problem.~~

~~**Don't forget to remove the environment variables when you are finished providing us with the logs.** You wouldn't want the extension to needlessly spend CPU time and disk space writing data you don't need into log files.~~
