#ifndef BOX_H
#define BOX_H

/**
 * Definition of a box object with three dimensions.
 */
struct box
{
    int length;
    int width;
    int height;

    int volume()
    {
        return length * width * height;
    }
};

#endif
