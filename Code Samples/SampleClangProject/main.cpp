#include <iostream>
#include <string>

using namespace std;

void greet(const string& person) {
    cout << "Hello, " << person << "!" << endl;
}

int main(int argc, char** argv) {
    if(argc >= 2) {
        greet(argv[1]);
    } else {
        cerr << "insufficient args, usage: " << argv[0] << " personNameHere" << endl;
    }
    return 0;
}
