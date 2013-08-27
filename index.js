// App module
(function($, _, Thorax, Backbone, Handlebars){
var app, forwardEvents, rewriteDataInterface, rewriteSync;

  /*-- utils --*/
  // Tidy up the gapi events interface
  forwardEvents = function(self) {
    if(!self) self = this;

    var capitalize = function(str) {
      return str[0].toUpperCase() + _.rest(str).join('');
    };

    return _.extend( self, {
      on: function(name, fn) {
        self['on'+capitalize(name)].add(fn);
      },

      off: function(name, fn) {
        self['on'+capitalize(name)].remove(fn);
      }
    });
  };

  // Rewrite data interface
  rewriteDataInterface = function(self) {
    if(!self) self = this;

    return _.extend( self, {
      clear: function(key) {
        if(key !== void 0) {
          // Simply forward function call
          return self.clearValue( key );

        } else {
          // Clear all
          var keys = self.getKeys();
          for(var i; i < keys.length; i++) self.clearValue( keys[i] );
        }
      },

      get: function(key) {
        if(key !== void 0) {
          // Forward call
          return self.getValue( key );

        } else {
          // Get all
          return self.getState();
        }
      },

      set: function(key, value) {
        if(_.isObject(key)) {
          for(var k in key) self.setValue( k, key[k] );
          return true;

        } else {
          return self.getValue( key, value );
        }
      }
    });
  };
  /*--/ utils --*/

  /*-- namespace --*/
  // Global app object
  app = _.extend({
    hangout: forwardEvents(gapi.hangout),
    data: forwardEvents(rewriteDataInterface(gapi.hangout.data)),

    models: {},
    collections: {},
    views: {},

    state: {}   // For storing shared app state
  }, Backbone.Events);

  // Rewrite Backbone Sync
  (rewriteSync = function(Backbone, store) {

    // Cache a reference to original sync function
    Backbone.ajaxSync = Backbone.sync;

    // Rewrite sync to use local state cache
    Backbone.sync = function(method, model, options) {
      var key, coll, isCollection, url, resp, data, errorMessage;

      options || options = {};
      url = options.url || _.result(model, 'url');

      if(model instanceof Backbone.Model) {
        key = _.first(url.split('/'));

      } else {
        // Get collection endpoint
        key = url;
        isCollection = true;
      }

      try {
        switch (method) {
          case 'read':
            resp = state[key];

            // Lookup model
            if(!isCollection)
              resp = _.findWhere(resp, {id: model.id});

            break;

          case 'create':
          case 'update':
            data = model.toJSON();

            if(isCollection) {
              // Add to shared state and then make a local copy
              app.data.set(key, data);
              state[key] = data;

            } else {
              coll = app.data.get(key) || [];

              // Append data to collection and save it
              coll.push(data);
              app.data.set(key, coll);
              app.state[key] = coll;
            }

            // Generate response
            resp = coll;
            break;

          case 'delete':
            app.data.clear(key);
            delete app.state[key];

            resp = true;
            break;
        }
      } catch(error) {
        // Twiddle thumbs for a bit
        errorMessage = error.message || 'Storage error';
      }

      // Send response
      if(resp && options.success)
        _.defer(options.success, resp);

      else if(errorMessage && options.error)
        _.defer(options.error, errorMessage);

      return resp || errorMessage;
    };
  })(Backbone, app.state);
  /*--/ namespace --*/

  /*-- models --*/
  // Define a Card Model
  app.models.Card = Thorax.Model.extend({});

  // Define Deck
  app.collections.Deck = Thorax.Collection.extend({
    model: app.models.Card,

    // Distribute deck among players
    distribute: function(players) {
      var shuffled, sets, slice;

      shuffled = this.shuffle();
      sets = [];

      slice = shuffled.length / players;

      for(var i = 0; i < shuffled.length; i += slice)
        sets.push(shuffled.slice(i, i + slice));

      return sets;
    }
  });

  // Initialize a deck.
  app.deck = new app.collections.Deck();

  // Add cards to deck
  app.deck.add((function(){
    var i, j, suits, ranks, cards;

    suits = ['hearts', 'spades', 'diamonds', 'clubs'];
    ranks = ['A', 2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K'];

    cards = [];

    // Add all 52 cards
    for (i = 0; i < suits.length; i++)
      for (j = 0; i < ranks.length; j++)
        cards.push({
          rank: ranks[j],
          suit: suits[i]
        });

    return cards;
  })());

  // Define player model
  app.models.Player = Throax.Model.extend({
    defaults: function(){
      return {
        addedAt: new Date().getTime()
      };
    },

    isMaster: function() {
      this.id = app.state['master'];
      return this.id;
    }
  });

  // Define players collection
  app.collections.Players = Thorax.Collection.extend({
    model: app.models.Player,
    comparator: function(player) { return player.get('addedAt'); },

    getMaster: function() {
      return this.find(function(model) { return model.isMaster(); });
    }
  });

  // Define notification model
  app.models.notification = Thorax.Model.extend({});
  /*--/ models --*/

  /*-- views --*/
  // Define layout view
  app.views.layout = Thorax.LayoutView;

  // Define card view
  app.views.card = Thorax.View.extend({
    events: {
      click: function() {
        // Return if deck covered
        if(this.parent && this.parent.covered) return;

        // Select cards
        this.$el.find('.card').toggleClass('selected');
        this.model.set('selected', !this.model.get('selected'));
      }
    },
    template: Handlebars.compile("<div class=\"card suit{{ suit }}\"><p>{{ rank }}</p>")
  });

  // Define deck view
  app.views.deck = Thorax.Views.extend({
    initialize: function() {
      // List of card views grouped by rank
      this.hands = {};
    },

    events: {
      collection: {
        all: function(e) {
          var collection;

          // Get collection value
          switch(e) {
            case 'add':
            case 'remove':
              collection = arguments[2];  // (event, model, collection)
              break;

            case 'reset':
              collection = arguments[1];  // (event, collection)
              break;

            default: return;
          }

          this.setHands(collection);
          this.render();
        }
      }
    },

    setHands: function(coll) {
      var groupedHands = coll.groupBy('rank');

      // Reset hands
      _.each(_.flatten(_.pairs(this.hands)), function(view) { view.remove(); });
      this.hands = {};

      for(var rank in groupedHands) {
        var group = groupedHands[rank];
        for(var i = 0; i < group.length; i++)
          group[i] = new app.views.card({ model: group[i] });

        this.hands[rank] = group;
      }
    },

    template: Handlebars.compile(
      "<div class=\"hand-container\">"+
        "{{#each hands}}"+
          "<div class=\"hand spread {{#if covered}}covered{{/if}}\">"+
            "{{#each this}}"+
              "{{view this}}"+
            "{{/each}}"+
          "</div>"+
        "{{/each}}"+
      "</div>"
    )
  });

  // Define view for "covered" deck, for the round.
  app.views.coveredDeck = app.views.deck.extend({
    covered: true,
    showLastHand: function() {
      this.$el.find('.covered:last').removeClass('covered');
    }
  });

  // Define notification view which disappears after some time
  app.views.notification = Thorax.View.extend({
    _defaultExpiration: 8 * 1000, // 8 seconds

    events: {
      model: {
        change: function() {
          // Hide after expiration time.
          _.delay(this.hide, this.model.expiration || this._defaultExpiration);

          // Render notification and display it.
          this.render();
          this.show();
        },
      },
    },

    hide: function() { this.$el.hide(); },
    show: function() { this.$el.show(); },

    template: Handlebars.compile(
      '<div class="notification">'+
        '<span>{{ message }}</span>'+
      '</div>'
    ),
  });

  // Define ending screen view
  app.views.gameEnd = Thorax.View.extend({
    events: {
      'click a[data-action="restartGame"]': function() {
        app.trigger('game:start');
      },
    },
    template: Handlebars.compile(
      "<div class=\"results\">"+
        "<h2>{{ person.displayName }} has won!</h2>"+
        "<a data-action=\"restartGame\">Play another game</a>"+
      "</div>"
    ),
  });

  /*--/ views --*/

  // Init
  $(function(){
    var setMaster, setTurn, setPlayers, nextTurn;

    // Function to set master (first player to join)
    setMaster = function() {
      var master;

      if(!app.data.get('master')) {
        master = app.hangout.getLocalParticipantId();

        app.data.set({ master: master });
        app.state['master'] = master;
      }

      return app.state['master'];
    };

    // Set turn
    setTurn = function(player) {
      var turn = { currentTurn: player.id };

      app.data.set(turn);
      app.trigger('send:message', player.id, { turn: true });

      return turn;
    };

    // Set up players
    setPlayers = function() {
      var playerData, hands, length, i;

      // Distribute deck
      hands = app.deck.distribute(length = app.players.length);

      // Go over each player and send them their hands
      i = 0;
      playerData = [];

      app.players.each(function(player) {
        // Send hand
        app.trigger('send:message', player.id, { hand: hands[i] });

        // Get data
        playerData.push({
          id: player.id,
          cards: hands[i].length
        });

        // Check for turn
        if(!_.isEmpty(_.findWhere(hands[i], { rank: 'A', suit: 'spades' })))
          setTurn(player);

        // Incr
        i++;
      });

      // Persist player data
      app.data.set('players', playerData);
      app.state['players'] = playerData;

      return playerData;
    };

    // Advance turn
    nextTurn = function(last) {
      var players = app.state['players'];

      for(var i = 0; i < players.length; i++) {
        if(players[i].id == last.id) break;
      }

      return setTurn(last);
    };

    // Initialize local player
    app.me = new Player();
    app.players = new Players();

    // Set up app
    app.hangout.on('apiReady', function(){

      // Send and receive messages
      app.data.on('messageReceived', function(message) {
        var to;

        // Parse message
        message = JSON.parse(message) || message;

        // If not addressed to any id, then broadcast.
        if(!(to = _.result(message, 'to'))) {
          app.trigger('broadcast:received', message);

        } else if(to == app.me.id) {
          app.trigger('message:received', message);
        }
      });

      app.on('message:send', function(id, message) {
        // Add metadata
        if(_.isObject(message)) {
          message.to = id;
          message.from = app.me.id;
        }

        app.data.sendMessage(JSON.stringify(message));
      });

      app.on('broadcast:send', function(message) {
        app.data.sendMessage(JSON.stringify(message));
      });

      // Dispatch messages
      app.on('message:received', function(message) {
        if(message.turn) {
          app.trigger('turn:play');

        } else if(message.hand) {
          app.trigger('hand:init', message.hand);
        }
      });

      // Auto update internal state
      app.data.on('stateChanged', function(e) {
        app.state = _.clone(e.state);
        app.trigger('state:change', app.state);
      });

      app.on('state:refresh', function() {
        app.state = _.clone(app.data.getState());
      });

      // Add local players
      app.me.set(app.hangout.getLocalParticipant());

      app.players.reset(app.hangout.getEnabledParticipants());
      app.hangout.on('participantsEnabled', function(participants) {
        app.players.reset(participants);
      });

      // Set master
      setMaster();
      app.hangout.on('participantsChanged', _.once(setMaster));

      app.hangout.on('appVisible', function() {

        // Do stuff here

      });
    });
  });

}).call(this, jQuery, _, Thorax, Backbone, Handlebars);
