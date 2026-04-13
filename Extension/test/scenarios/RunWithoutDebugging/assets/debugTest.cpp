#include <fstream>

int main() {
    std::ofstream resultFile("runWithoutDebuggingResult.txt");
    if (!resultFile) {
        return 1;
    }

    resultFile << 37;
    return 0;
}
