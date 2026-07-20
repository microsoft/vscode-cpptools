# Creates a modal dialog window which displays the text given as an argument
# Used by main.cpp host_assert_message to display assert information

#!/bin/bash

set -e

zenity --error --no-markup --title 'Assertion Failure' --text "$1"

# This code can be uncommented later and be used as a
# starting place for using exit codes to provide better debug support
#while true; do
#  ans=$(zenity --error --title 'Assertion Failure' \
#      --text "$1" ) #\
      #--ok-label A \
      #--extra-button B --extra-button C)
  #rc=$?
  #echo "${rc}-${ans}"
#done
