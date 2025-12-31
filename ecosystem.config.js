module.exports = {
  apps: [{
    name: "dashboard-firme",
    script: "root-app.js",
    instances: 1,
    exec_mode: "fork",
    watch: false,
    max_memory_restart: "256M",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      LOG_DIR: "/var/www/vhosts/dashboard.brixware.ws/logs",
      DB_HOST: "80.211.136.249",
      DB_PORT: 3306,
      DB_USER: "firmedigitali",
      DB_PASSWORD: "uk5igls1EO#%B5mi",
      DB_NAME: "firmedigitali",
      DB_TABLE: "digital_signatures",
      DB_ASSET_TABLE: "digital_signatures_assets",
      DB_DOCUMENT_TABLE: "digital_signatures_documents"
    },
    error_file: "/var/www/vhosts/dashboard.brixware.ws/logs/pm2-error.log",
    out_file: "/var/www/vhosts/dashboard.brixware.ws/logs/pm2-out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 4000
  }]
};