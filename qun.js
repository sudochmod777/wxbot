'use strict';
var fs = require('fs');
var logger = require('./logger')('./applog.json');
var webwx = require('./wxapi');
var yunmof = require('./yunmof');

const ENTRY_URL = 'https://web.weixin.qq.com/';

if (process.argv.length <= 2) {
  console.log("用法: node qun.js [群主云魔方ID]");
  process.exit(-1);
}

var ownerId = process.argv[2];
var room = null;
var roomContact = null;
var dpath = './log/' + ownerId;

var isRoomContact = function(e) {
  return e ? /^@@|@chatroom$/.test(e) : !1;
};

var fetchRoom = function(callback) {
  if (room) return callback(null, room);

  yunmof.getInfo(ownerId, function(err, result) {
    if (err) return callback(err);
    room = result.info_response;
    return callback(null, room);
  });
};

var client = new webwx(ENTRY_URL);
client.enableLog(dpath);

var onStrangerInviting = function(wx, msg, callback) {
  var username = msg.RecommendInfo.UserName;
  var ticket = msg.RecommendInfo.Ticket;
  var nickname = msg.RecommendInfo.NickName;

  logger.debug('收到 <' + nickname + '> 的添加好友邀请...');
  wx.verifyUser(username, ticket, function(err, result) {
    if (err) return callback(err);
    
    if (result.BaseResponse.Ret != 0) {
      return callback(
        new Error('接受添加好友邀请时出现错误，详情：' + result.BaseResponse.ErrMsg)
      );
    }

    return callback();
  });
};

var welcomeNewcomer = function(wx, username) {
  var msg = '[抱拳] 欢迎使用呱呱群管家，请回复群口令继续完成加群操作！';
  return wx.sendMsg(username, msg, function(err) {});
};

var createQun = function(wx, topic, callback) {
  var members = [];
  for (var id in wx.contacts) {
    var c = wx.contacts[id];
    if (members.length >= 2) break;
    if (!isRoomContact(c.UserName) && c.SnsFlag == 1) {
      members.push(c.UserName);
    }
  }

  wx.createChatRoom(topic, members, function(err, result) {
    if (err) return callback(err);
    if (result.Topic.length <= 0) {
      return callback(
        new Error('建群失败：\n' + result.BaseResponse.ErrMsg)
      );
    }

    roomContact = result.ChatRoomName;
    wx.delFromChatRoom(roomContact, members.join(','), function(err, result) {
      var msg = '付费群【' + topic + '】创建成功';
      return wx.sendMsg(roomContact, msg, callback);
    });
  });
};

var autoCreateQun = function(wx, callback) {
  if (roomContact) return callback();

  fetchRoom(function(err, r) {
    if (err) return callback();
    var exists = wx.findRoomByNick(r.name);


    if (exists) {
      roomContact = exists.UserName;
      return callback();
    }
    
    
    if (r.members.length > 0) {
      if (exists) {
        roomContact = exists.UserName;
      }
      return callback();
    }
    
    if (exists) {
      var newName = r.name + '【新】';
      room = null;
      return yunmof.updateInfo(ownerId, newName, callback);
    }

    return createQun(wx, r.name, callback);
  });
};

client.onQR(function(imgUrl) {
  logger.debug('下载二维码：' + imgUrl);
  return yunmof.changeState(ownerId, 'offline', function(err, result) {
    yunmof.qrcode(ownerId, imgUrl, function(err, result) {
    });
  });
}).onPreloaded(function() {
  logger.debug('完成登录');
  return yunmof.changeState(ownerId, 'online', function(err, result) {
  });
}).onNewContact(function(contact) {
  return welcomeNewcomer(client, contact.UserName);
}).onFMessage(function(msg, callback) {
  return onStrangerInviting(client, msg, callback);
}).onSysMessage(function(msg, callback) {
  console.log(msg);
  return callback();
}).onMessage(function(msg, callback) {
  console.log(msg);
  return callback();
}).onUpdate(function(callback) {
  return autoCreateQun(client, callback);
}).start(function(err, result) {
  if (err) {
    return logger.error(err);
  }

  return logger.info(result);
});