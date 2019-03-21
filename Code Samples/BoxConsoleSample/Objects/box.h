#ifndef BOX_H
#define BOX_H

/**
 * Box object
 * Defines Box and its properties
 */
struct Box {
   public:
      int length;
      int width;
      int height;
   
      int volume(int length, int width, int height){
        return length * width * height;
      }
};

#endif

