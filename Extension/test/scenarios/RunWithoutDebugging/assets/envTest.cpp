#include <cstdlib>
#include <fstream>

int main(int argc, char *argv[]) {
    if (argc < 3) {
        return 1;
    }

    const char *value = std::getenv(argv[1]);

    std::ofstream resultFile(argv[2]);
    if (!resultFile) {
        return 2;
    }

    if (value) {
        resultFile << value;
    }

    return 0;
}
