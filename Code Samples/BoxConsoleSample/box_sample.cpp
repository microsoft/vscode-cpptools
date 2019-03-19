#include <iostream>
#include "Objects/box.h"
using namespace std;

/**
 * Main takes in Box dimensions
 * Calculates and prints Box volume
 */
int main() {
   Box package;
   package.length = int{};
   cout << "Enter package length: \n" << std::flush;
   std::cin >> package.length;

   package.width = int{};
   cout << "Enter package width: \n" << std::flush;
   std::cin >> package.width;

   package.height = int{};
   cout << "Enter package height: \n" << std::flush;
   std::cin >> package.height;

   cout << "Package volume is: " << package.volume(package.length, package.width, package.height) << endl;
}