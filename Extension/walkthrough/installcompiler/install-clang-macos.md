# Install a C++ compiler on macOS

If you're doing C++ development for macOS, we recommend installing the Clang compiler. All you need to do is run the following command in a Terminal window to install the command line developer tools:

```bash
xcode-select --install
```

Then, to verify that clang is installed, run the following command in a Terminal window. You should see a message with information about the version of Clang you're using.

```bash
clang --version
```