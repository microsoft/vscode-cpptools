# How to enable logging in the extension

If you are experiencing a problem that we are unable to diagnose based on information in your issue report, we might ask you to enable logging and send us your logs.

As of version 0.14.0 of the extension, logging information is now delivered directly to the Output window in VSCode. To turn on full logging for an issue report, add `"C_Cpp.loggingLevel": "Information"` or `"C_Cpp.loggingLevel": "Debug"` to your **settings.json**.

![image](https://user-images.githubusercontent.com/12818240/44601186-8a2af380-a790-11e8-9094-7064d1ba3cfb.png)

VS Code organizes the logging from different extensions to improve readability so you must select the "C/C++" option in the log filter selector to see logging from the C/C++ extension:

![image](https://user-images.githubusercontent.com/12818240/39769357-d6673bea-52a0-11e8-86c6-3be91618e8fc.png)

