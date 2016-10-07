// @flow

window.isTop = true;

// $FlowIssue: good def
chrome.runtime.onMessage.addListener((message: Object, sender: chrome$MessageSender) => {
  console.log('TOP GOT MESSAGE!', message, sender);

  // if (message.type === 'load' && !message.isTop) {
  //   const rect: Object = message.data.rect;
  //   $('<div/>')
  //     .appendTo($(document.body))
  //     .css({
  //       position: 'absolute',
  //       background: 'black',
  //       opacity: 0.2,
  //       top: rect.top,
  //       left: rect.left,
  //       width: rect.width,
  //       height: rect.height
  //     });
  // }
});
