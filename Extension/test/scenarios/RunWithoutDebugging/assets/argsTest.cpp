#include <fstream>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        return 1;
    }

    std::ofstream resultFile(argv[1]);
    if (!resultFile) {
        return 2;
    }

    for (int i = 2; i < argc; ++i) {
        resultFile << argv[i];
        if (i + 1 < argc) {
            resultFile << '\n';
        }
    }

    return 0;
}
