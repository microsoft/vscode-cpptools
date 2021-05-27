
# Install a C++ compiler on Linux
If you're doing C++ development for Linux, we recommend installing the GCC compiler. Installing GCC is simple, just follow these three steps:

1. Run the following command from the terminal window to update the Ubuntu package lists. An out-of-date Linux distribution can sometimes interfere with attempts to install new packages.

    ```bash
    sudo apt-get update
    ```

2. Install the GNU compiler tools and the GDB debugger with this command:

    ```bash
    sudo apt-get install build-essential gdb

3. Verify GCC is installed by running the following command. You should see a copyright message and information about the version of GCC you're using.

    ```bash
    gcc --version
    ```