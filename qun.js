'use strict';
var fs = require('fs');
var async = require('async')
var webwx = require('./wxapi');
var yunmof = require('./yunmof');

const ENTRY_URL = 'https://wx.qq.com/';

if (process.argv.length <= 2) {
  console.log("用法: node qun.js [群主云魔方ID]");
  process.exit(-1);
}

var ownerId = process.argv[2];
var rs = null;
var roomContact = null;
var dpath = './log/' + ownerId + '-' + (new Date()).getTime();
var logger = require('./logger')(dpath + '/log.json');

var isRoomContact = function(e) {
  return e ? /^@@|@chatroom$/.test(e) : !1;
};

var fetchRoom = function(callback) {
  if (rs) return callback(null, rs);

  yunmof.getInfo(ownerId, function(err, result) {
    if (err) return callback(err);
    rs = result.info_response;
    return callback(null, rs);
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
    if (!isRoomContact(c.UserName) && c.ContactFlag == 3 && c.VerifyFlag == 0 && c.UserName[0] == '@') {
      logger.warn('添加 <' + c.NickName + '> 到群中。。。');
      members.push(c.UserName);
    }
  }

  if (members.length != 2) {
    return callback(new Error('找不到可以加入的群成员！'));
  }

  wx.createChatRoom(topic, members, function(err, result) {
    if (err) return callback(err);
    console.log(result);
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
    
   /* 
    if (r.members.length > 0) {
      if (exists) {
        roomContact = exists.UserName;
      }
      return callback();
    }
    
    if (exists) {
      var newName = r.name + '【新】';
      rs = null;
      return yunmof.updateInfo(ownerId, newName, callback);
    }
   */

    return createQun(wx, r.name, callback);
  });
};

var addToChatRoom = function(wx, member, roomC, callback) {
  async.waterfall([
    function(callback) {
      var msg = '令牌有效, 正在将您 <' + member.NickName + '> 加入群 <' + roomC.NickName + '>';
      logger.debug(msg);
  
      return wx.sendMsg(member.UserName, msg, function(err, result) {
        if (err) return callback(err);
        callback();
      });
    },
    function(callback) {
      return wx.addToChatRoom(roomC.UserName, member.UserName, function(err, result) {
        if (err) return callback(err);
        callback();
      });
    },
    function(callback) {
      var msg = '热烈欢迎 <' + member.NickName + '> 加入本群！';
      logger.debug(msg);
  
      return wx.sendMsg(roomC.UserName, msg, function(err, result) {
        if (err) return callback(err);
        callback();
      });
    }
  ], function(err, result) {
    return callback(err, result);
  });
};

var joinQun = function(wx, code, username, callback) {
  var member = wx.contacts[username];
  var roomC = wx.contacts[roomContact];
  var nickname = member.NickName;

  logger.debug('用户<' + nickname + '>提交群令牌<' + code + '>，尝试入群');
  yunmof.joinQun(ownerId, code, nickname, function(err, result) {
    if (err) {
      return wx.sendMsg(member.UserName, "令牌无效或已经过期！", callback);
    }

    var qunId = result.membership_join_response.qunid;
    var qunName = result.membership_join_response.name;
    
    console.log(result);
    return addToChatRoom(wx, member, roomC, callback);
  });
};

var onNewMemberJoined = function(wx, room, inviter, invitees, callback) {
  setTimeout(function() {
    wx.updateContactList([room.UserName], function(err, result) {
      if (err) return;

      var inviteeList = invitees.split('、');
      var illegals = [];
      if (inviter != '你') {
        var members = result.ContactList[0].MemberList;
        for (var i in members) {
          var m = members[i];
          if (inviteeList.indexOf(m.NickName) >= 0) {
            illegals.push(m.UserName);
          }
        }
      }

      if (illegals.length == 0) return callback();

      wx.delFromChatRoom(room.UserName, illegals.join(','), function(err, result) {
        var msg = '[警告]: ' + inviter + ' 未经授权邀请 ' + invitees + ' 入群，已经处理！';
        logger.info(msg);
        wx.sendMsg(room.UserName, msg, function(err, result){
          return callback();
        });
      });
    });
  }, 5000);
};

var processSysMsg = function(wx, sourceUserName, content, callback) {
  if (!(sourceUserName in wx.contacts))
    return callback(new Error('无效的系统信息来源！'));

  if (roomContact != sourceUserName) return callback();

  var source = wx.contacts[sourceUserName];

  var inviting = content.match(/(.+)邀请(.+)加入了群聊$/);
  if (inviting) {
    return onNewMemberJoined(wx, source, inviting[1], inviting[2], callback);
  }

  var sharing = content.match(/(.+)通过扫描(.+)分享的二维码加入群聊$/);
  if (sharing) {
    return onNewMemberJoined(wx, source, sharing[2], sharing[1], callback);
  }

  return callback();
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
}).onFMessage(function(from, msg, callback) {
  return onStrangerInviting(client, msg, callback);
}).onSysMessage(function(from, msg, callback) {
  var from = msg.FromUserName;
  var content = msg.Content;
  return processSysMsg(client, from, content, callback);
}).onTextMessage(function(from, msg, callback) {
  var cmd = msg.Content;
  if (cmd.length == 19) {
    return joinQun(client, cmd, msg.FromUserName, callback);
  }
  return callback();
}).onUpdate(function(callback) {
  return autoCreateQun(client, callback);
}).start(function(err, result) {
  if (err) {
    return logger.error(err);
  }

  return logger.info(result);
});
