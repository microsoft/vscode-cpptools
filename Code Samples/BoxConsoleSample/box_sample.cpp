#include <iostream>
#include "Objects/box.h"

using namespace std;

/**
 * Calculate and print the volume of a box.
 */
int main()
{
    box package{ 10, 10, 10 };
    cout << "Package length: " << package.length << endl;
    cout << "Package width:  " << package.width << endl;
    cout << "Package height: " << package.height << endl;
    cout << "Package volume: " << package.volume() << endl;
}