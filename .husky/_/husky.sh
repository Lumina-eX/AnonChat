#!/bin/sh
if [ -z "$husky_skip_init" ]; then
  debug () {
    if [ "$HUSKY_DEBUG" = "1" ]; then
      echo "husky (debug) - $1"
    fi
  }

  readonly hook_name="$(basename "$0")"
  debug "running $hook_name"
  if [ -f ~/.huskyrc ]; then
    debug "sourcing ~/.huskyrc"
    . ~/.huskyrc
  fi
  if [ -e /dev/stdin ]; then
    debug "reading hook type with </dev/stdin"
    read hook_type
  fi
  readonly skip_arg="--no-verify"
  for arg in "$@"; do
    if [ "$arg" = "$skip_arg" ]; then
      debug "skip arg supplied ($skip_arg)"
      husky_skip_init=1
      break
    fi
  done
  export husky_skip_init
  sh -e "$(dirname "$0")/$hook_name.sh" "$@"
  exitCode=$?

  if [ $exitCode != 0 ]; then
    echo ""
    echo "husky - $hook_name hook exited with code $exitCode (error)"
  fi
  if [ $exitCode = 127 ]; then
    echo ""
    echo "husky - $hook_name hook not found (in $(dirname "$0")/$hook_name.sh)"
    exitCode=0
  fi

  exit $exitCode
fi
