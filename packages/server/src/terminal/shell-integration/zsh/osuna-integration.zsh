if [[ -n "${_OSUNA_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _OSUNA_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _OSUNA_ZSH_COMMAND_ACTIVE=0

function _osuna_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _osuna_precmd() {
  local command_status=$?
  if [[ "$_OSUNA_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _osuna_osc633 "D;${command_status}"
    _OSUNA_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _osuna_osc633 "A"
}

function _osuna_preexec() {
  _OSUNA_ZSH_COMMAND_ACTIVE=1
  _osuna_osc633 "B"
  _osuna_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _osuna_precmd
add-zsh-hook preexec _osuna_preexec
