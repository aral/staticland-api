var fs = require('fs')
var path = require('path')
var Model = require('level-model')
var inherits = require('util').inherits
var pathExists = require('path-exists')

var vhost = require('./vhost')
var createCertbot = require('./cert')
var siteDirectories = require('./site-directories')

module.exports = Site
inherits(Site, Model)

function Site (db, config) {
  if (!(this instanceof Site)) return new Site(db, config)
  this.debug = config.debug
  this.dirs = siteDirectories(config)
  this.reserved = config.reservedSubdomains
  this.requestCerts = config.requestCerts
  this.reloadNginx = config.reloadNginx
  config.dirs = this.dirs
  config.letsEncryptCommand = config.letsEncryptCommand || '/home/staticland/certbot-auto'
  this.letsEncryptDir = config.letsEncryptDir = config.letsEncryptDir || '/home/staticland/letsencrypt'
  this.cert = createCertbot(config)

  var opts = {
    modelName: 'site',
    properties: {
      domain: { type: 'string' },
      deploys: { type: 'number', default: 0 },
      owners: { type: 'array', default: [] },
      certCreated: { type: ['string', 'null'], default: null },
      certRenewed: { type: ['string', 'null'], default: null }
    },
    indexKeys: ['domain', 'owners'],
    required: ['domain']
  }

  Model.call(this, db, opts)
}

Site.prototype.redirect = function siteRedirect (options, callback) {
  options.vhostsDir = this.dirs.vhostsDir
  options.reloadNginx = this.reloadNginx
  var existingVhost = path.join(options.vhostsDir, options.redirect + '.conf')
  pathExists(existingVhost).then(function (exists) {
    if (!exists) return callback()
    fs.unlink(existingVhost, function (err) {
      if (err) return callback(err)
      vhost.redirect(options, callback)
    })
  })
}

Site.prototype.firstDeploy = function siteDeploy (opts, callback) {
  if (!opts) return callback(new Error('options object with domain and owners properties required'))
  if (!opts.domain) return callback(new Error('domain property required'))
  if (!opts.owners) return callback(new Error('owners property required'))
  var self = this

  var isSubdomain = opts.domain.indexOf('static.land') > -1
  var matchesReserved = this.reserved.indexOf(opts.domain.split('.static.land')[0]) > -1

  if (isSubdomain && matchesReserved) {
    return callback(new Error('subdomain ' + opts.domain + ' not available'))
  }

  this.findByDomain(opts.domain, function (err, site) {
    if (err) console.log('creating site with domain', opts.domain)

    var options = {
      domain: opts.domain,
      vhostsDir: self.dirs.vhostsDir,
      sitesDir: self.dirs.sitesDir,
      certsDir: path.join(self.letsEncryptDir, 'config'),
      reloadNginx: self.reloadNginx
    }

    if (!site) {
      self.dirs.create(opts.domain, function (err) {
        if (err) return callback(err)
        self.cert.create(options, function (err, stdout, stderr) {
          if (err) return callback(new Error('Unable to request certificate from Lets Encrypt'))
          vhost.ssl(options, save)
        })
      })
    } else {
      vhost.ssl(options, save)
    }

    function save (err) {
      if (err) return callback(err)

      var obj = {
        owners: opts.owners,
        domain: opts.domain,
        deploys: 1,
        certCreated: self.timestamp()
      }

      self.save(obj, callback)
    }
  })
}

Site.prototype.destroy = function (domain, callback) {
  var self = this
  this.findByDomain(domain, function (err, site) {
    if (err) return callback(err)
    self.delete(site.key, function (err) {
      if (err) return callback(err)
      self.dirs.destroy(domain, callback)
    })
  })
}

Site.prototype.findByDomain = function findByDomain (domain, callback) {
  this.findOne('domain', domain, function (err, site) {
    if (err) return callback(new Error('Not found'))
    else return callback(null, site)
  })
}

Site.prototype.addOwner = function (opts, callback) {
  if (!opts) return callback(new Error('options object with domain and owner properties required'))
  if (!opts.domain) return callback(new Error('domain property required'))
  if (!opts.owner) return callback(new Error('owner property required'))
  var self = this

  this.findByDomain(opts.domain, function (err, site) {
    if (err) return callback(err)
    site.owners.push(opts.owner)
    self.update(site, callback)
  })
}

Site.prototype.removeOwner = function (opts, callback) {
  if (!opts) return callback(new Error('options object with domain and owner properties required'))
  if (!opts.domain) return callback(new Error('domain property required'))
  if (!opts.owner) return callback(new Error('owner property required'))
  var self = this

  this.findByDomain(opts.domain, function (err, site) {
    if (err) return callback(err)
    var index = site.owners.indexOf(opts.owner)
    site.owners.splice(index, 1)
    self.update(site, callback)
  })
}
