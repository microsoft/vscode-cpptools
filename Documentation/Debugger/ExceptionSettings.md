# Exception Settings

The Microsoft Windows C/C++ debugger (cppvsdbg) supports configuration options for if the debugger stops when exceptions are thrown. This is done with the 'All Exceptions' check box in the BREAKPOINTS section of the 'Run and Debug' view.

Note that the BREAKPOINTS section will be missing this entry until the first time that the folder has been debugged with the 'cppvsdbg' debugger.

Checking 'All Exceptions' will configure the debugger to stop when an exception is thrown.

##### Exception Conditions

The 'All Exceptions' checkbox support conditions to break on only selected exception types (C++ exceptions) or codes (Win32 exceptions). To edit the condition, click on the pencil icon or right click on the entry and invoke 'Edit Condition'. The condition is a comma-separated list of exception types and codes to break on, or if the list starts with '!', a list of exception types and codes to ignore.

Examples conditions:

| Example condition value | Result |
|-------------------------|--------|
| 0xC0000005, 0xC0000094 | Break on Win32 Access Violation exceptions and integer division by zero exceptions |
| std::out_of_range, 0xC0000005 | This will break on out-of-range exceptions, and access violation exceptions |
| !MyExceptionClass | This will break on all exceptions except C++ `MyExceptionClass` exceptions |
| !MyExceptionClass, 0x6831C815 | This will break on all exceptions except C++ `MyExceptionClass` exceptions and Win32 exceptions with custom code 0x6831C815 |
