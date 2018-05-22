#### Old information (it still works, but is no longer recommended):

Logging is controlled by environment variables and is disabled by default. To enable logging, launch VS Code from an environment that contains the following variables:

```
VSCODE_CPP_LOGDIR=c:\path\to\logfolder
VSCODE_CPP_LOGFILE_LEVEL=5
```

When you open your folder in VS Code, we will create a **vscode.cpp.log.\<pid\>.txt** file for each extension process launched (\<pid\> = process id).

The log file level is a number that determines how much detail we'll log. Level 5 is generally detailed enough to give us information about what is going on in your session. We don't recommend you set this higher than 7 since the log quickly becomes cluttered with information that doesn't really help us diagnose your issues and actually makes it harder for us to spot problems. It may also slow down the extension considerably and make it harder for you to reproduce your problem.

**Note:** You will likely need to reload the window or close VS Code to flush the contents of the log file since we do not flush the log after every call. If your log file seems to be empty, try reloading the window after you have followed the steps to reproduce your issue.

**Don't forget to remove the environment variables when you are finished providing us with the logs.** You wouldn't want the extension to needlessly spend CPU time and disk space writing data you don't need into log files.
