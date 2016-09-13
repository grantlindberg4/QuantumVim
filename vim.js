var gState = {
  _state: "NORMAL",
  get: function() {
    return this._state;
  },
  set: function(newState) {
    this._state = newState;
    updateStatusBar();
  }
};
var gKeyQueue = "";
var gLinkCodes = {};

document.addEventListener('keypress', function(evt){
  console.log("State before: " + gState.get());
  let keyStr = (evt.ctrlKey ? "C-" : "") + evt.key;
  console.log("Key: " + keyStr);
  // TODO: Handling state in a global var is not good enough,
  // consider some design pattern here
  switch (gState.get()) {
    case "NORMAL":
      // TODO: extract the command <-> action mapping to a config file
      switch (keyStr) {
        case 'h':
          // TODO: make the scroll configurable
          window.scrollBy(-19, 0);
          break;
        case 'j':
          window.scrollByLines(1);
          break;
        case 'k':
          window.scrollByLines(-1);
          break;
        case 'l':
          window.scrollBy(19, 0);
          break;
        case 'g':
          gState.set("GOTO");
          break;
        case 'G':
          window.scrollTo(window.scrollX, document.body.scrollHeight);
          break;
        case 'J':
          //chrome.tabs.update(1, {selected: true});
          chrome.runtime.sendMessage({type:'switch_tab_left'});
          break;
        case 'K':
          chrome.runtime.sendMessage({type:'switch_tab_right'});
          break;
        case 'H':
          // TODO: any reason we want to this this in the background script?
          history.back();
          break;
        case 'L':
          // TODO: any reason we want to this this in the background script?
          history.forward();
          break;
        case 'f':
          highlight_links();
          gState.set("FOLLOW");
          break;
        case 'r':
          chrome.runtime.sendMessage({ type: 'reload', bypassCache: false });
          break;
        case 'R':
          chrome.runtime.sendMessage({ type: 'reload', bypassCache: true });
          break;
        case 'y':
          copyCurrentLocation();
          break;
        case 'Y':
          document.execCommand('copy');
          break;
        case 'd':
          chrome.runtime.sendMessage({ type: 'close_tab', focusLeft: false });
          break;
        case 'D':
          chrome.runtime.sendMessage({ type: 'close_tab', focusLeft: true });
          break;
        case 'C-b':
          window.scrollByPages(-1);
          break;
        case 'C-f':
          window.scrollByPages(1);
          break;
        case 'C-d':
          window.scrollBy(0, window.innerHeight / 2);
          break;
        case 'C-u':
          window.scrollBy(0, -window.innerHeight / 2);
          break;
        case 'I':
          gState.set("INSERT");
          break;
      }
      break;
    case "GOTO":
      switch (keyStr) {
        case 'g':
          window.scrollTo(window.scrollX, 0);
          break;
      }
      gState.set("NORMAL");
      break;
    case "FOLLOW":
      switch (keyStr) {
        case "Escape":
          console.log("ESC => NORMAL mode");
          follow_to_normal();
          break;
        case "Enter":
          follow_link(gKeyQueue);
          break;
        default:
          console.log("Follow code: " + keyStr);
          accumulate_link_codes(keyStr);
          break;
      }
      break;
    case "INSERT":
      switch (keyStr) {
        case "Escape":
          console.log("ESC => NORMAL mode");
          document.activeElement.blur();
          gState.set("NORMAL");
          break;
      }
      break;
  }
  console.log("State after: " + gState.get());
});


window.addEventListener('load', function(){
  autoInsertModeElements = ['INPUT', 'TEXTAREA'];

  document.addEventListener('focusin', function(evt){
    if (autoInsertModeElements.includes(evt.target.tagName)){
      console.log("Input box focused, goto INSERT mode");
      // TODO: use gState.get() when status bar patch landed
      gState = "INSERT";
    }
  });
  document.addEventListener('focusout', function(evt){
    if (autoInsertModeElements.includes(evt.target.tagName)){
      console.log("Input box blurred, goto NORMAL mode");
      gState = "NORMAL";
    }
  });

  if (autoInsertModeElements.includes(document.activeElement.tagName)){
    console.log("Input box focused on page load, goto INSERT mode");
    gState = "INSERT";
  }
});

function copyToClipboard(str) {
  // Once bug 1197451 is done, we can use Services.clipboardRead/Write
  var textArea = document.createElement("textarea");
  textArea.value = str;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

function copyCurrentLocation() {
  // Copy the canonical link if possible.
  // This will copy short urls such as https://bugzil.la/<id>.
  let links = document.getElementsByTagName('link');
  for (let link of links) {
    if (link.rev == "canonical") {
      copyToClipboard(link.href);
      return;
    }
  }

  copyToClipboard(window.location.href);
}

/* Link Following */
function highlight_links() {
  // TODO: buttons, inputs
  var links = document.querySelectorAll('a');
  // TODO: asdfghjkl; codes
  var code = 0;
  Array.prototype.forEach.call(links, function(elem){
    // console.log(elem);
    elem._originalBackgroundColor = elem.style.backgroundColor;
    elem._originalPosition = elem.style.position;
    elem.style.backgroundColor = 'yellow';

    var codehint = document.createElement('span');
    codehint.textContent = code;
    codehint.style.border="solid 1px black";
    codehint.style.backgroundColor="white";
    codehint.style.font="12px/14px bold sans-serif";
    codehint.style.color="darkred";
    codehint.style.position="absolute";
    codehint.style.top="0";
    codehint.style.left="0";
    codehint.style.padding="0.1em";

    elem.style.position="relative";
    elem.appendChild(codehint);

    gLinkCodes[String(code)] = {
      'element':elem,
      'codehint': codehint
    };
    code += 1;
  });
}

function reduce_highlights(remain_pattern) {
  for (var code in gLinkCodes) {
    if (!code.startsWith(remain_pattern)) {
      gLinkCodes[code].element.style.backgroundColor = gLinkCodes[code].element._originalBackgroundColor;
      gLinkCodes[code].element.style.position= gLinkCodes[code].element._originalPosition;
      gLinkCodes[code].codehint.remove();
    }
  }
}

function accumulate_link_codes(keyStr){
  console.log("Received " + keyStr + ", current queue: " + gKeyQueue);
  // TODO: make this more generic, handle chars
  if (!(/^[0-9]$/.test(keyStr))){
    return;
  }
  gKeyQueue += keyStr;
  newGLinkCodes = {};
  for (var code in gLinkCodes){
    if (code.startsWith(gKeyQueue)){
      // TODO: many return a new list instead?
      newGLinkCodes[code] = gLinkCodes[code];
    }
  }

  var matchesCount = Object.keys(newGLinkCodes).length;
  console.log("Found " + matchesCount + " matches");

  if (matchesCount === 0) {
    // Cleanup and go back to normal mode
    follow_to_normal();
  }
  else if (matchesCount === 1) {
    // Go to the link!
    follow_link(gKeyQueue);
  }
  else {
    reduce_highlights(gKeyQueue);
    gLinkCodes = newGLinkCodes;
  }
}

function follow_link(key){
  console.log("Clicking " + key);
  if (typeof(gLinkCodes[key]) !== "undefined") {
    gLinkCodes[key].element.click();
  }
  follow_to_normal();
}

function follow_to_normal() {
  reduce_highlights("NEVER_MATCH");
  gLinkCodes = {};
  gKeyQueue = "";
  gState.set("NORMAL");
}

function updateStatusBar(){
  console.log("State changed to " + gState.get());
  if (gState.get() == "NORMAL") {
    document.getElementById("statusbar").textContent = "";
  }
  else {
    document.getElementById("statusbar").textContent = "-- " + gState.get() + " --";
  }
}

function initStatusBar(){
  var statusbar = document.createElement('span');
  statusbar.style.position = "fixed";
  statusbar.style.bottom = "0";
  statusbar.style.left = "0";
  statusbar.style.backgroundColor = "rgba(219,219, 182, 0.5)";
  statusbar.style.color = "black";
  statusbar.id = "statusbar";

  document.body.appendChild(statusbar);
}

window.addEventListener('load', function(){
  autoInsertModeElements = ['INPUT', 'TEXTAREA'];

  function registerAndEnterAutoInsertMode(elem){
      console.log("Adding auto insert mode listener for element: " + elem);
      elem.addEventListener('focus', function(evt){
        console.log("Input box focused, goto INSERT mode");
        gState.set("INSERT");
      });
      elem.addEventListener('blur', function(evt){
        console.log("Input box blurred, goto NORMAL mode");
        gState.set("NORMAL");
      });
  }

  for (let tagName of autoInsertModeElements){
    var inputs = document.getElementsByTagName(tagName);
    Array.prototype.forEach.call(inputs, registerAndEnterAutoInsertMode);
    if (document.activeElement.tagName == tagName){
      console.log("Input box focused on page load, goto INSERT mode");
      gState.set("INSERT");
    }
  }

  initStatusBar();
});
